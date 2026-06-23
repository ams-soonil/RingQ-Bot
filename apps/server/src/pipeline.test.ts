import { describe, it, expect, vi } from 'vitest';
import { createStore } from './store.js';
import { createPipeline } from './pipeline.js';
import { createCaseGenerator } from './cases/generator.js';
import { createFakeLLM } from './llm/fake.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';
import type { FigmaExtract, FigmaClient } from './figma/client.js';
import { createRunner } from './runner/runner.js';
import { createFakeDriver } from './browser/fake.js';

const extract: FigmaExtract = {
  fileKey: 'ABC',
  frames: [{ nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [], colors: ['#fff'] }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => extract };
const input = { figmaLinks: ['https://www.figma.com/file/ABC/My?node-id=1-2'], siteUrl: 'https://example.com' };

function makeDeps() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  const driver = createFakeDriver({ screen: { texts: ['홈'], elements: [] } });
  const runner = createRunner({ store, driver }, { artifactDir: 'data/test-runs' });
  return { store, generator, figma: fakeFigma, runner };
}

describe('pipeline generate 단계', () => {
  it('케이스를 생성·저장하고 awaiting-review에서 멈춘다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    const phases: string[] = [];
    const listener = (ev: ProgressEvent) => phases.push(ev.phase);
    runEvents.on(run.id, listener);

    await createPipeline(deps, { delayMs: 0 })(run.id);

    runEvents.off(run.id, listener);
    expect(deps.store.getRun(run.id)!.phase).toBe('awaiting-review');
    expect(deps.store.listCases(run.id).length).toBeGreaterThan(0); // 프레임당 UI 케이스 보장
    expect(phases).toContain('generating-cases');
    expect(phases).toContain('awaiting-review');
    expect(phases).not.toContain('done');
  });
});

describe('pipeline resume 단계', () => {
  it('cases-confirmed면 runner로 캡처 저장 후 done으로 끝낸다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    deps.store.saveCases(run.id, [
      { id: 'tc_1', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: 'UI', figmaNodeId: '1:2' },
    ]);
    deps.store.updateRun(run.id, { phase: 'cases-confirmed' });

    await createPipeline(deps, { delayMs: 0 })(run.id);

    expect(deps.store.getRun(run.id)!.phase).toBe('done');
    expect(deps.store.listCaptures(run.id).length).toBe(1);
  });
});

describe('pipeline 에러 처리', () => {
  it('figma 실패 시 failed로 표시하고 rethrow한다', async () => {
    const deps = makeDeps();
    const failingFigma: FigmaClient = {
      fetchExtract: vi.fn(async () => {
        throw new Error('figma boom');
      }),
    };
    const run = deps.store.createRun(input);
    const p = createPipeline({ ...deps, figma: failingFigma }, { delayMs: 0 });
    await expect(p(run.id)).rejects.toThrow('figma boom');
    expect(deps.store.getRun(run.id)!.phase).toBe('failed');
    expect(deps.store.getRun(run.id)!.status).toBe('failed');
  });
});
