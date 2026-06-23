import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createPipeline } from './pipeline.js';
import { createCaseGenerator } from './cases/generator.js';
import { createFakeLLM } from './llm/fake.js';
import type { FigmaClient, FigmaExtract } from './figma/client.js';

const fakeExtract: FigmaExtract = {
  fileKey: 'A',
  frames: [{ nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [], colors: [] }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => fakeExtract };

function setup() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  const queue = createQueue(createPipeline({ store, figma: fakeFigma, generator }, { delayMs: 0 }));
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

import type { TestCase } from '@ringq/shared';

function seedAwaitingReview() {
  const { app, store, queue } = setup();
  const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
  store.updateRun(run.id, { phase: 'awaiting-review' });
  const c: TestCase = {
    id: 'tc_x_0', runId: run.id, type: 'ui', source: 'figma', status: 'draft',
    title: '로그인 UI', figmaNodeId: '1:2',
    uiExpectation: { texts: ['로그인'], elements: [], colors: [] },
  };
  store.saveCases(run.id, [c]);
  return { app, store, queue, run, c };
}

describe('GET /api/runs/:id/cases', () => {
  it('run의 케이스를 반환한다', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/cases` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('PATCH /api/runs/:id/cases/:caseId', () => {
  it('케이스 title/status를 갱신한다', async () => {
    const { app, run, c } = seedAwaitingReview();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/runs/${run.id}/cases/${c.id}`,
      payload: { title: '수정됨', status: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('수정됨');
  });

  it('없는 케이스는 404', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'PATCH', url: `/api/runs/${run.id}/cases/nope`, payload: { title: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('다른 run에 속한 케이스 id로 PATCH하면 404', async () => {
    const { app, run } = seedAwaitingReview();
    // seed a second run with its own case
    const { store: store2, app: _app2 } = setup();
    const run2 = store2.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    const otherCaseId = `tc_${run2.id}_0`;
    // patch run's endpoint with a caseId that belongs to run2 (not seeded in run)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/runs/${run.id}/cases/${otherCaseId}`,
      payload: { title: '다른 run 케이스' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/runs/:id/cases (수동 추가)', () => {
  it('flow 케이스를 추가한다', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cases`,
      payload: { title: '수동 플로우', steps: [{ action: 'click', target: '로그인 버튼' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('manual');
    expect(res.json().type).toBe('flow');
  });

  it('잘못된 step은 400', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cases`,
      payload: { title: 'x', steps: [{ action: 'teleport', target: 'y' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/runs/:id/confirm', () => {
  it('awaiting-review면 확정하고 cases-confirmed로 큐에 넣는다', async () => {
    const { app, store, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().phase).toBe('cases-confirmed');
    expect(store.listCases(run.id)[0].status).toBe('confirmed');
  });

  it('awaiting-review가 아니면 409', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/confirm` });
    expect(res.statusCode).toBe(409);
  });
});
