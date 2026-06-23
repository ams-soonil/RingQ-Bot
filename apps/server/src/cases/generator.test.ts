import { describe, it, expect } from 'vitest';
import { createCaseGenerator } from './generator.js';
import { createFakeLLM } from '../llm/fake.js';
import type { FigmaExtract } from '../figma/client.js';

const extract: FigmaExtract = {
  fileKey: 'ABC',
  frames: [
    { nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [{ type: 'INSTANCE', name: '로그인 버튼' }], colors: ['#ff0000'] },
    { nodeId: '1:9', name: '홈', texts: ['환영합니다'], elements: [], colors: [] },
  ],
  transitions: [{ fromNodeId: '1:4', toNodeId: '1:9', trigger: 'ON_CLICK' }],
};

describe('case generator', () => {
  it('유효한 flow 초안은 유지하고 환각 flow는 버린다', async () => {
    const llm = createFakeLLM([
      { type: 'flow', title: '로그인 플로우', steps: [{ action: 'click', target: '로그인 버튼' }, { action: 'navigate', target: '홈' }] },
      { type: 'flow', title: '환각 플로우', steps: [{ action: 'click', target: '존재하지않는화면' }] },
    ]);
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);

    const flows = cases.filter((c) => c.type === 'flow');
    expect(flows.map((f) => f.title)).toContain('로그인 플로우');
    expect(flows.map((f) => f.title)).not.toContain('환각 플로우');
  });

  it('LLM이 UI 케이스를 안 줘도 프레임마다 기본 UI 케이스를 보장한다', async () => {
    const llm = createFakeLLM([]); // 아무 초안 없음
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);

    const ui = cases.filter((c) => c.type === 'ui');
    expect(ui.map((c) => c.figmaNodeId).sort()).toEqual(['1:2', '1:9']);
    const login = ui.find((c) => c.figmaNodeId === '1:2')!;
    expect(login.uiExpectation?.texts).toContain('로그인');
    expect(login.uiExpectation?.colors).toContain('#ff0000');
    expect(login.source).toBe('figma');
    expect(login.status).toBe('draft');
    expect(login.id).toMatch(/^tc_run_1_/);
  });

  it('figmaNodeId 없는 UI 초안은 버리고 프레임마다 UI 케이스를 1개씩 보장한다', async () => {
    const llm = createFakeLLM([
      { type: 'ui', title: '노드없는 UI' }, // figmaNodeId 없음 → 스킵되어야 함
    ]);
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);

    // (a) 노드없는 초안 타이틀은 결과에 없어야 함
    expect(cases.map((c) => c.title)).not.toContain('노드없는 UI');

    // (b) UI 케이스는 프레임 수와 동일하게 1개씩 (총 2개, 중복 없음)
    const ui = cases.filter((c) => c.type === 'ui');
    expect(ui).toHaveLength(2);
    expect(ui.map((c) => c.figmaNodeId).sort()).toEqual(['1:2', '1:9']);
  });

  it('잘못된 action만 제거하고 남은 step이 0이면 케이스를 버린다', async () => {
    const llm = createFakeLLM([
      { type: 'flow', title: '깨진 플로우', steps: [{ action: 'teleport', target: '로그인' }] },
    ]);
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);
    expect(cases.filter((c) => c.title === '깨진 플로우')).toHaveLength(0);
  });
});
