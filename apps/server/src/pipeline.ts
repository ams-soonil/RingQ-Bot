import type { RunPhase } from '@ringq/shared';
import type { Store } from './store.js';
import { emitProgress, now } from './events.js';

const STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'generating-cases', message: 'Figma에서 테스트 케이스 생성 중...' },
  { phase: 'running', message: 'Playwright로 사이트 실행 중...' },
  { phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...' },
  { phase: 'reporting', message: '리포트 작성 중...' },
];

export function createSkeletonPipeline(store: Store, opts: { delayMs?: number } = {}) {
  const delayMs = opts.delayMs ?? 0;
  return async (runId: string): Promise<void> => {
    try {
      for (const step of STEPS) {
        store.updateRun(runId, { phase: step.phase });
        emitProgress({ runId, phase: step.phase, message: step.message, at: now() });
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
      store.updateRun(runId, { phase: 'done', status: 'done' });
      emitProgress({ runId, phase: 'done', message: 'QA 완료', at: now() });
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
