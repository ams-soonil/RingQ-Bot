import { describe, it, expect } from 'vitest';
import { createStore } from './store.js';

const input = { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' };

describe('store', () => {
  it('Run을 생성하면 queued/active 상태로 시작한다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    expect(run.id).toMatch(/^run_/);
    expect(run.phase).toBe('queued');
    expect(run.status).toBe('active');
    expect(run.siteUrl).toBe(input.siteUrl);
  });

  it('getRun으로 조회된다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    expect(store.getRun(run.id)?.id).toBe(run.id);
    expect(store.getRun('nope')).toBeUndefined();
  });

  it('updateRun으로 phase/status를 갱신한다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    const updated = store.updateRun(run.id, { phase: 'running' });
    expect(updated.phase).toBe('running');
    expect(store.getRun(run.id)?.phase).toBe('running');
  });

  it('없는 id를 update하면 throw한다', () => {
    const store = createStore(':memory:');
    expect(() => store.updateRun('nope', { phase: 'done' })).toThrow(/run not found/);
  });

  it('listRuns는 최신순으로 반환한다', () => {
    const store = createStore(':memory:');
    const a = store.createRun(input);
    const b = store.createRun(input);
    const ids = store.listRuns().map((r) => r.id);
    expect(ids[0]).toBe(b.id);
    expect(ids[1]).toBe(a.id);
  });
});
