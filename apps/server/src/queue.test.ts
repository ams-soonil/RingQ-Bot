import { describe, it, expect } from 'vitest';
import { createQueue } from './queue.js';

describe('queue', () => {
  it('잡을 직렬로 처리하고 onIdle로 완료를 기다린다', async () => {
    const processed: string[] = [];
    const q = createQueue(async (runId) => {
      await new Promise((r) => setTimeout(r, 5));
      processed.push(runId);
    });
    q.enqueue('a');
    q.enqueue('b');
    await q.onIdle();
    expect(processed).toEqual(['a', 'b']);
    expect(q.size()).toBe(0);
  });

  it('handler가 throw해도 다음 잡을 계속 처리한다', async () => {
    const processed: string[] = [];
    const q = createQueue(async (runId) => {
      if (runId === 'bad') throw new Error('boom');
      processed.push(runId);
    });
    q.enqueue('bad');
    q.enqueue('good');
    await q.onIdle();
    expect(processed).toEqual(['good']);
  });
});
