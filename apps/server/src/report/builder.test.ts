import { describe, it, expect } from 'vitest';
import { buildReport } from './builder.js';
import type { Finding } from '@ringq/shared';

function f(severity: Finding['severity']): Finding {
  return { id: 'x', runId: 'r1', caseId: 'c', category: 'x', severity, message: 'm', source: 'structural' };
}

describe('buildReport', () => {
  it('레벨별 카운트와 total', () => {
    const r = buildReport('r1', [f('success'), f('improvement'), f('warning'), f('issue'), f('success')], 'now');
    expect(r.total).toBe(5);
    expect(r.success).toBe(2);
    expect(r.improvement).toBe(1);
    expect(r.warning).toBe(1);
    expect(r.issue).toBe(1);
    expect(r.generatedAt).toBe('now');
  });
  it('warning/issue 있으면 fail', () => {
    expect(buildReport('r1', [f('warning')], 'now').verdict).toBe('fail');
    expect(buildReport('r1', [f('issue')], 'now').verdict).toBe('fail');
  });
  it('success/improvement만이거나 결과 없으면 pass', () => {
    expect(buildReport('r1', [f('success'), f('improvement')], 'now').verdict).toBe('pass');
    expect(buildReport('r1', [], 'now').verdict).toBe('pass');
  });
});
