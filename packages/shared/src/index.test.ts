import { describe, it, expect } from 'vitest';
import { ProjectInputSchema, ProgressEventSchema, RunPhaseSchema, TestCaseSchema, RunCaptureSchema } from './index.js';

describe('ProjectInputSchema', () => {
  it('유효한 입력을 통과시킨다', () => {
    const parsed = ProjectInputSchema.parse({
      figmaLinks: ['https://figma.com/file/abc'],
      siteUrl: 'https://example.com',
    });
    expect(parsed.figmaLinks).toHaveLength(1);
    expect(parsed.gitUrl).toBeUndefined();
  });

  it('figmaLinks가 비면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: [], siteUrl: 'https://example.com' }),
    ).toThrow();
  });

  it('siteUrl이 URL이 아니면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: ['https://figma.com/x'], siteUrl: 'not-a-url' }),
    ).toThrow();
  });
});

describe('ProgressEventSchema', () => {
  it('phase enum을 검증한다', () => {
    expect(() =>
      ProgressEventSchema.parse({ runId: 'r1', phase: 'invalid', message: 'x', at: 'now' }),
    ).toThrow();
  });
});

describe('RunPhaseSchema 확장', () => {
  it('awaiting-review와 cases-confirmed를 허용한다', () => {
    expect(RunPhaseSchema.parse('awaiting-review')).toBe('awaiting-review');
    expect(RunPhaseSchema.parse('cases-confirmed')).toBe('cases-confirmed');
  });
});

describe('TestCaseSchema', () => {
  it('UI 케이스를 검증한다', () => {
    const c = TestCaseSchema.parse({
      id: 'tc_1',
      runId: 'run_1',
      type: 'ui',
      source: 'figma',
      status: 'draft',
      title: '로그인 화면 UI',
      figmaNodeId: '1:2',
      uiExpectation: { texts: ['로그인'], elements: ['button'], colors: ['#ff0000'] },
    });
    expect(c.type).toBe('ui');
  });

  it('flow 케이스의 step action을 검증한다', () => {
    const c = TestCaseSchema.parse({
      id: 'tc_2',
      runId: 'run_1',
      type: 'flow',
      source: 'manual',
      status: 'draft',
      title: '로그인 플로우',
      steps: [{ action: 'click', target: '로그인 버튼' }],
    });
    expect(c.steps?.[0].action).toBe('click');
  });

  it('잘못된 step action을 거부한다', () => {
    expect(() =>
      TestCaseSchema.parse({
        id: 'tc_3',
        runId: 'run_1',
        type: 'flow',
        source: 'manual',
        status: 'draft',
        title: 'x',
        steps: [{ action: 'teleport', target: 'x' }],
      }),
    ).toThrow();
  });
});

describe('RunCaptureSchema', () => {
  it('UI 캡처를 검증한다', () => {
    const c = RunCaptureSchema.parse({
      caseId: 'tc_1', runId: 'run_1', type: 'ui',
      url: 'https://e.com', texts: ['로그인'], elements: ['button'],
      screenshotPath: 'data/runs/run_1/tc_1.png',
    });
    expect(c.texts).toContain('로그인');
  });

  it('flow 캡처의 flowOk와 error를 허용한다', () => {
    const c = RunCaptureSchema.parse({
      caseId: 'tc_2', runId: 'run_1', type: 'flow',
      url: 'https://e.com', texts: [], elements: [], flowOk: false, error: 'click 실패',
    });
    expect(c.flowOk).toBe(false);
    expect(c.error).toBe('click 실패');
  });
});

describe('TestCase.routePath', () => {
  it('routePath를 허용한다', () => {
    const c = TestCaseSchema.parse({
      id: 'tc_1', runId: 'run_1', type: 'ui', source: 'figma', status: 'draft',
      title: '로그인 UI', routePath: '/login',
    });
    expect(c.routePath).toBe('/login');
  });
});
