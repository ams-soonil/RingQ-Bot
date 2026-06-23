import { describe, it, expect, vi } from 'vitest';
import { createStore } from './store.js';
import { createSkeletonPipeline } from './pipeline.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' };

describe('skeleton pipeline', () => {
  it('모든 phase를 순서대로 진행하고 done으로 끝낸다', async () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    const phases: string[] = [];
    const listener = (ev: ProgressEvent) => phases.push(ev.phase);
    runEvents.on(run.id, listener);

    await createSkeletonPipeline(store, { delayMs: 0 })(run.id);

    runEvents.off(run.id, listener);
    expect(phases).toEqual(['generating-cases', 'running', 'comparing', 'reporting', 'done']);
    const final = store.getRun(run.id)!;
    expect(final.phase).toBe('done');
    expect(final.status).toBe('done');
  });

  it('phase 실행 중 에러 발생 시 run을 failed로 표시하고 에러를 rethrow한다', async () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);

    // Mock the first updateRun call (generating-cases phase) to throw
    vi.spyOn(store, 'updateRun').mockImplementationOnce(() => {
      throw new Error('boom');
    });

    // Pipeline should reject
    await expect(createSkeletonPipeline(store, { delayMs: 0 })(run.id)).rejects.toThrow('boom');

    // Run should be marked as failed
    const failed = store.getRun(run.id)!;
    expect(failed.phase).toBe('failed');
    expect(failed.status).toBe('failed');
  });
});
