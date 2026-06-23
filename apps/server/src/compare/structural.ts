import type { Finding, RunCapture, TestCase } from '@ringq/shared';

export type PartialFinding = Omit<Finding, 'id' | 'runId'>;

function includesText(haystack: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return haystack.some((h) => h.toLowerCase().includes(n));
}

export function structuralCompare(tc: TestCase, cap: RunCapture): PartialFinding[] {
  if (cap.error) {
    return [{ caseId: tc.id, category: 'capture-error', severity: 'critical', message: `캡처 실패: ${cap.error}`, source: 'structural' }];
  }

  const findings: PartialFinding[] = [];

  if (tc.type === 'ui' && tc.uiExpectation) {
    for (const text of tc.uiExpectation.texts) {
      if (!includesText(cap.texts, text)) {
        findings.push({ caseId: tc.id, category: 'missing-text', severity: 'major', message: `기대 텍스트 "${text}"가 화면에 없음`, source: 'structural' });
      }
    }
    for (const el of tc.uiExpectation.elements) {
      if (!includesText(cap.elements, el)) {
        findings.push({ caseId: tc.id, category: 'missing-element', severity: 'major', message: `기대 요소 "${el}"가 화면에 없음`, source: 'structural' });
      }
    }
  }

  if (tc.type === 'flow' && cap.flowOk === false) {
    findings.push({ caseId: tc.id, category: 'flow-failed', severity: 'major', message: '플로우 일부 단계 실패', source: 'structural' });
  }

  return findings;
}
