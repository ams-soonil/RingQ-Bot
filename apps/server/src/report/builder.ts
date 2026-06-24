import type { Finding, Report } from '@ringq/shared';

export function buildReport(runId: string, findings: Finding[], generatedAt: string): Report {
  const success = findings.filter((f) => f.severity === 'success').length;
  const improvement = findings.filter((f) => f.severity === 'improvement').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  const issue = findings.filter((f) => f.severity === 'issue').length;
  return {
    runId,
    total: findings.length,
    success,
    improvement,
    warning,
    issue,
    // 경고(기능/가독성 영향) 또는 이슈(핵심 누락/검증불가)가 있으면 불합격. 성공/개선만이면 합격.
    verdict: warning + issue > 0 ? 'fail' : 'pass',
    generatedAt,
  };
}
