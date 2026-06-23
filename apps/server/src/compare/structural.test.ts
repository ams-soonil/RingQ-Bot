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
  it('기대 텍스트/요소가 모두 있으면 finding 없음', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인 화면', '비밀번호 입력'], elements: ['로그인 버튼'] }));
    expect(f).toHaveLength(0);
  });

  it('누락된 텍스트는 missing-text(major)', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인 화면'], elements: ['로그인 버튼'] }));
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('missing-text');
    expect(f[0].severity).toBe('major');
    expect(f[0].source).toBe('structural');
    expect(f[0].message).toContain('비밀번호');
  });

  it('누락된 요소는 missing-element(major)', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인', '비밀번호'], elements: [] }));
    expect(f.some((x) => x.category === 'missing-element')).toBe(true);
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
