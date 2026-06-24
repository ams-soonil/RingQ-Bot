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
import { createComparator } from './compare/comparator.js';
import { createFakeVision } from './compare/vision-fake.js';
import { createFakeSuggester } from './report/suggester-fake.js';

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
  const comparator = createComparator({ store, figma: fakeFigma, vision: createFakeVision([]) });
  const suggester = createFakeSuggester('가이드');
  return { store, generator, figma: fakeFigma, runner, comparator, suggester };
}

describe('pipeline generate 단계 (검수 스킵 자동 확정)', () => {
  it('케이스를 생성하면 자동 확정 후 멈추지 않고 done까지 진행한다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    const phases: string[] = [];
    const listener = (ev: ProgressEvent) => phases.push(ev.phase);
    runEvents.on(run.id, listener);

    await createPipeline(deps, { delayMs: 0 })(run.id);

    runEvents.off(run.id, listener);
    expect(deps.store.listCases(run.id).length).toBeGreaterThan(0); // 프레임당 UI 케이스 보장
    expect(deps.store.listCases(run.id).every((c) => c.status === 'confirmed')).toBe(true); // 자동 확정
    expect(deps.store.getRun(run.id)!.phase).toBe('done'); // 검수에서 멈추지 않고 끝까지
    expect(phases).toContain('generating-cases');
    expect(phases).toContain('cases-confirmed');
    expect(phases).not.toContain('awaiting-review'); // 검수 단계 없음
    expect(phases).toContain('done');
  });
});

describe('pipeline resume 단계', () => {
  it('cases-confirmed면 캡처+비교 후 done, finding 저장', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    deps.store.saveCases(run.id, [
      { id: 'tc_1', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: 'UI', figmaNodeId: '1:2', uiExpectation: { texts: ['없는텍스트'], elements: [], colors: [] } },
    ]);
    deps.store.updateRun(run.id, { phase: 'cases-confirmed' });

    await createPipeline(deps, { delayMs: 0 })(run.id);

    expect(deps.store.getRun(run.id)!.phase).toBe('done');
    expect(deps.store.listCaptures(run.id).length).toBe(1);
    expect(deps.store.listFindings(run.id).length).toBeGreaterThan(0); // 기대 텍스트 누락 → 구조 finding
    const report = deps.store.getReport(run.id);
    expect(report?.verdict).toBe('fail'); // major finding → fail
    expect(report?.suggestion).toBe('가이드'); // findings>0 → 수정 가이드 부착
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
