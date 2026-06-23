import type { RunPhase } from '@ringq/shared';
import type { Store } from './store.js';
import type { FigmaClient } from './figma/client.js';
import type { CaseGenerator } from './cases/generator.js';
import { emitProgress, now } from './events.js';

interface PipelineDeps {
  store: Store;
  figma: FigmaClient;
  generator: CaseGenerator;
}

const RESUME_STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'running', message: 'Playwright로 사이트 실행 중...' },
  { phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...' },
  { phase: 'reporting', message: '리포트 작성 중...' },
];

export function createPipeline(deps: PipelineDeps, opts: { delayMs?: number } = {}) {
  const { store, figma, generator } = deps;
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
    for (const step of RESUME_STEPS) {
      store.updateRun(runId, { phase: step.phase });
      emitProgress({ runId, phase: step.phase, message: step.message, at: now() });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
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
