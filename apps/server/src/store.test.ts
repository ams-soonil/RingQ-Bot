import { describe, it, expect } from 'vitest';
import { createStore } from './store.js';
import type { TestCase } from '@ringq/shared';

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

const uiCase: TestCase = {
  id: 'tc_1', runId: 'r1', type: 'ui', source: 'figma', status: 'draft',
  title: '로그인 UI', figmaNodeId: '1:2',
  uiExpectation: { texts: ['로그인'], elements: ['로그인 버튼'], colors: ['#ff0000'] },
};
const flowCase: TestCase = {
  id: 'tc_2', runId: 'r1', type: 'flow', source: 'figma', status: 'draft',
  title: '로그인 플로우', steps: [{ action: 'click', target: '로그인 버튼' }],
};

describe('store test_cases', () => {
  it('saveCases/listCases 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, flowCase]);
    const got = store.listCases('r1');
    expect(got).toHaveLength(2);
    expect(got[0].uiExpectation?.texts).toEqual(['로그인']);
    expect(got[1].steps?.[0].target).toBe('로그인 버튼');
  });

  it('saveCases는 기존 케이스를 교체한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, flowCase]);
    store.saveCases('r1', [uiCase]);
    expect(store.listCases('r1')).toHaveLength(1);
  });

  it('updateCase로 title/status를 갱신한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase]);
    const u = store.updateCase('tc_1', { title: '수정됨', status: 'rejected' });
    expect(u.title).toBe('수정됨');
    expect(store.listCases('r1')[0].status).toBe('rejected');
  });

  it('없는 case update는 throw', () => {
    const store = createStore(':memory:');
    expect(() => store.updateCase('nope', { title: 'x' })).toThrow(/case not found/);
  });

  it('addCase로 수동 케이스를 추가한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase]);
    store.addCase({ ...flowCase, id: 'tc_manual', source: 'manual' });
    expect(store.listCases('r1')).toHaveLength(2);
  });

  it('confirmCases는 draft만 confirmed로 바꾼다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, { ...flowCase, status: 'rejected' }]);
    store.confirmCases('r1');
    const got = store.listCases('r1');
    expect(got.find((c) => c.id === 'tc_1')?.status).toBe('confirmed');
    expect(got.find((c) => c.id === 'tc_2')?.status).toBe('rejected');
  });
});

import type { RunCapture, Finding } from '@ringq/shared';

const cap1: RunCapture = {
  caseId: 'tc_1', runId: 'r1', type: 'ui', url: 'https://e.com',
  texts: ['로그인'], elements: ['button'], screenshotPath: 'data/runs/r1/tc_1.png',
};
const cap2: RunCapture = {
  caseId: 'tc_2', runId: 'r1', type: 'flow', url: 'https://e.com',
  texts: [], elements: [], flowOk: false, error: 'click 실패',
};

describe('store captures', () => {
  it('saveCaptures/listCaptures 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveCaptures('r1', [cap1, cap2]);
    const got = store.listCaptures('r1');
    expect(got).toHaveLength(2);
    expect(got[0].texts).toEqual(['로그인']);
    expect(got[0].screenshotPath).toBe('data/runs/r1/tc_1.png');
    expect(got[1].flowOk).toBe(false);
    expect(got[1].error).toBe('click 실패');
  });

  it('saveCaptures는 기존 캡처를 교체한다', () => {
    const store = createStore(':memory:');
    store.saveCaptures('r1', [cap1, cap2]);
    store.saveCaptures('r1', [cap1]);
    expect(store.listCaptures('r1')).toHaveLength(1);
  });
});

const f1: Finding = { id: 'fd_1', runId: 'r1', caseId: 'tc_1', category: 'missing-text', severity: 'major', message: 'x', source: 'structural' };
const f2: Finding = { id: 'fd_2', runId: 'r1', caseId: 'tc_1', category: 'layout', severity: 'minor', message: 'y', source: 'vision' };

describe('store findings', () => {
  it('saveFindings/listFindings 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveFindings('r1', [f1, f2]);
    const got = store.listFindings('r1');
    expect(got).toHaveLength(2);
    expect(got[0].severity).toBe('major');
    expect(got[1].source).toBe('vision');
  });

  it('saveFindings는 기존을 교체한다', () => {
    const store = createStore(':memory:');
    store.saveFindings('r1', [f1, f2]);
    store.saveFindings('r1', [f1]);
    expect(store.listFindings('r1')).toHaveLength(1);
  });
});

import type { Report } from '@ringq/shared';
const rep: Report = { runId: 'r1', total: 2, critical: 0, major: 1, minor: 1, verdict: 'fail', generatedAt: 'now', suggestion: '가이드' };

describe('store report', () => {
  it('saveReport/getReport 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveReport(rep);
    expect(store.getReport('r1')?.verdict).toBe('fail');
    expect(store.getReport('r1')?.suggestion).toBe('가이드');
  });
  it('saveReport는 같은 run을 교체한다', () => {
    const store = createStore(':memory:');
    store.saveReport(rep);
    store.saveReport({ ...rep, verdict: 'pass', suggestion: undefined });
    expect(store.getReport('r1')?.verdict).toBe('pass');
    expect(store.getReport('r1')?.suggestion).toBeUndefined();
  });
  it('없으면 undefined', () => {
    expect(createStore(':memory:').getReport('nope')).toBeUndefined();
  });
});

describe('store credentials', () => {
  it('createRun에 계정을 주면 getCredentials로 조회되고 Run엔 비번이 없다', () => {
    const store = createStore(':memory:');
    const run = store.createRun({ figmaLinks: ['https://figma.com/file/x'], siteUrl: 'https://e.com', username: 'u', password: 'p' });
    expect(store.getCredentials(run.id)).toEqual({ username: 'u', password: 'p' });
    expect((run as Record<string, unknown>).password).toBeUndefined();
  });
  it('계정 없이 생성하면 getCredentials undefined', () => {
    const store = createStore(':memory:');
    const run = store.createRun({ figmaLinks: ['https://figma.com/file/x'], siteUrl: 'https://e.com' });
    expect(store.getCredentials(run.id)).toBeUndefined();
  });
});
