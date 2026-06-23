import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createSkeletonPipeline } from './pipeline.js';

function setup() {
  const store = createStore(':memory:');
  const queue = createQueue(createSkeletonPipeline(store, { delayMs: 0 }));
  const app = buildApp({ store, queue });
  return { store, queue, app };
}

describe('POST /api/runs', () => {
  it('유효한 입력이면 201과 Run을 반환하고 큐에 넣는다', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^run_/);
    expect(body.phase).toBe('queued');
  });

  it('잘못된 입력이면 400을 반환한다', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { figmaLinks: [], siteUrl: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });
});

describe('GET /api/runs/:id', () => {
  it('없는 id면 404를 반환한다', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/runs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('생성된 Run을 조회한다', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' });
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(run.id);
  });
});
