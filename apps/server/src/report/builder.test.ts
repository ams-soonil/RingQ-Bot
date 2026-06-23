import { describe, it, expect } from 'vitest';
import { buildReport } from './builder.js';
import type { Finding } from '@ringq/shared';

function f(severity: Finding['severity']): Finding {
  return { id: 'x', runId: 'r1', caseId: 'c', category: 'x', severity, message: 'm', source: 'structural' };
}

describe('buildReport', () => {
  it('심각도별 카운트와 total', () => {
    const r = buildReport('r1', [f('critical'), f('major'), f('minor'), f('minor')], 'now');
    expect(r.total).toBe(4);
    expect(r.critical).toBe(1);
    expect(r.major).toBe(1);
    expect(r.minor).toBe(2);
    expect(r.generatedAt).toBe('now');
  });
  it('critical/major 있으면 fail', () => {
    expect(buildReport('r1', [f('major')], 'now').verdict).toBe('fail');
    expect(buildReport('r1', [f('critical')], 'now').verdict).toBe('fail');
  });
  it('minor만이거나 결함 없으면 pass', () => {
    expect(buildReport('r1', [f('minor')], 'now').verdict).toBe('pass');
    expect(buildReport('r1', [], 'now').verdict).toBe('pass');
  });
});
