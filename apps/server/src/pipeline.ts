import type { Store } from './store.js';
import type { FigmaClient } from './figma/client.js';
import type { CaseGenerator } from './cases/generator.js';
import type { Runner } from './runner/runner.js';
import type { Comparator } from './compare/comparator.js';
import type { FixSuggester } from './report/suggester-types.js';
import { buildReport } from './report/builder.js';
import { emitProgress, now } from './events.js';

interface PipelineDeps {
  store: Store;
  figma: FigmaClient;
  generator: CaseGenerator;
  runner: Runner;
  comparator: Comparator;
  suggester: FixSuggester;
}

export function createPipeline(deps: PipelineDeps, opts: { delayMs?: number } = {}) {
  const { store, figma, generator, runner, comparator, suggester } = deps;
  const delayMs = opts.delayMs ?? 0;

  async function generate(runId: string): Promise<void> {
    const run = store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    store.updateRun(runId, { phase: 'generating-cases' });
    emitProgress({ runId, phase: 'generating-cases', message: 'Figma에서 테스트 케이스 생성 중...', at: now() });

    const extract = await figma.fetchExtract(run.figmaLinks[0]);
    const cases = await generator.generate(runId, extract);
    store.saveCases(runId, cases);

    store.updateRun(runId, { phase: 'awaiting-review' });
    emitProgress({
      runId,
      phase: 'awaiting-review',
      message: `케이스 ${cases.length}개 생성됨 — 검수 후 확정해 주세요`,
      at: now(),
    });
  }

  async function resume(runId: string): Promise<void> {
    // running (실제 Playwright 캡처)
    store.updateRun(runId, { phase: 'running' });
    emitProgress({ runId, phase: 'running', message: 'Playwright로 사이트 캡처 중...', at: now() });
    const captures = await runner.run(runId);
    store.saveCaptures(runId, captures);
    emitProgress({ runId, phase: 'running', message: `${captures.length}개 화면 캡처 완료`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // comparing (실제 하이브리드 비교)
    store.updateRun(runId, { phase: 'comparing' });
    emitProgress({ runId, phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...', at: now() });
    const findings = await comparator.compare(runId);
    store.saveFindings(runId, findings);
    emitProgress({ runId, phase: 'comparing', message: `결함 ${findings.length}건 발견`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // reporting (실제: 리포트 + 베스트에포트 수정 가이드)
    store.updateRun(runId, { phase: 'reporting' });
    emitProgress({ runId, phase: 'reporting', message: '리포트 작성 중...', at: now() });
    const reportFindings = store.listFindings(runId);
    const report = buildReport(runId, reportFindings, now());
    if (reportFindings.length > 0) {
      try {
        const confirmedCases = store.listCases(runId).filter((c) => c.status === 'confirmed');
        report.suggestion = await suggester.suggest(reportFindings, confirmedCases);
      } catch {
        // 수정 가이드 실패는 무시(리포트는 저장)
      }
    }
    store.saveReport(report);
    emitProgress({ runId, phase: 'reporting', message: `리포트 완료 — ${report.verdict.toUpperCase()}`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    store.updateRun(runId, { phase: 'done', status: 'done' });
    emitProgress({ runId, phase: 'done', message: 'QA 완료', at: now() });
  }

  return async (runId: string): Promise<void> => {
    try {
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      if (run.phase === 'queued' || run.phase === 'generating-cases') {
        await generate(runId);
      } else if (run.phase === 'cases-confirmed') {
        await resume(runId);
      }
    } catch (err) {
      store.updateRun(runId, { phase: 'failed', status: 'failed' });
      emitProgress({
        runId,
        phase: 'failed',
        message: err instanceof Error ? err.message : '알 수 없는 오류',
        at: now(),
      });
      throw err;
    }
  };
}
