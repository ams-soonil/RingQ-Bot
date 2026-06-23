import type { Finding, Report } from '@ringq/shared';

export function buildReport(runId: string, findings: Finding[], generatedAt: string): Report {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const major = findings.filter((f) => f.severity === 'major').length;
  const minor = findings.filter((f) => f.severity === 'minor').length;
  return {
    runId,
    total: findings.length,
    critical,
    major,
    minor,
    verdict: critical + major > 0 ? 'fail' : 'pass',
    generatedAt,
  };
}
