import { describe, it, expect } from 'vitest';
import { structuralCompare } from './structural.js';
import type { TestCase, RunCapture } from '@ringq/shared';

const uiCase: TestCase = {
  id: 'tc_1', runId: 'r1', type: 'ui', source: 'figma', status: 'confirmed',
  title: '로그인 UI', figmaNodeId: '1:2',
  uiExpectation: { texts: ['로그인', '비밀번호'], elements: ['로그인 버튼'], colors: [] },
};

function cap(partial: Partial<RunCapture>): RunCapture {
  return { caseId: 'tc_1', runId: 'r1', type: 'ui', url: 'https://e.com', texts: [], elements: [], ...partial };
}

describe('structuralCompare', () => {
  it('리터럴 텍스트/요소 매칭은 하지 않는다(노이즈 제거) — 누락이어도 finding 없음', () => {
    // uiExpectation의 텍스트/요소가 화면에 없어도 structural은 더 이상 missing-* 를 내지 않는다.
    const f = structuralCompare(uiCase, cap({ texts: [], elements: [] }));
    expect(f).toHaveLength(0);
  });

  it('cap.error가 있으면 capture-error(critical) 하나만', () => {
    const f = structuralCompare(uiCase, cap({ error: 'goto 실패' }));
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('capture-error');
    expect(f[0].severity).toBe('critical');
  });

  it('flow가 flowOk=false면 flow-failed(major)', () => {
    const flowCase: TestCase = { id: 'tc_2', runId: 'r1', type: 'flow', source: 'figma', status: 'confirmed', title: '플로우', steps: [{ action: 'click', target: 'x' }] };
    const f = structuralCompare(flowCase, { caseId: 'tc_2', runId: 'r1', type: 'flow', url: 'https://e.com', texts: [], elements: [], flowOk: false });
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('flow-failed');
  });
});
