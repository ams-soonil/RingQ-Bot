import type { Finding, RunCapture, TestCase } from '@ringq/shared';

export type PartialFinding = Omit<Finding, 'id' | 'runId'>;

/**
 * 구조 비교는 "확실한 사실"만 다룬다 — 캡처 실패, 플로우 단계 실패.
 *
 * 기대 텍스트/요소의 리터럴 substring 매칭은 제거했다. 화면설계서의 텍스트에는
 * 화면 ID/화면명/화면경로 같은 메타, 와이어프레임 장식, 조건부 다이얼로그·토스트 문구가
 * 섞여 있어 실제 화면에 그대로 떠야 하는 텍스트가 아니다. 리터럴 매칭 시 대량의 가짜
 * missing 결함이 생긴다. 설계 충족 여부는 디스크립션 기반 LLM 비교가 의미 단위로 판단한다.
 */
export function structuralCompare(tc: TestCase, cap: RunCapture): PartialFinding[] {
  if (cap.error) {
    return [{ caseId: tc.id, category: 'capture-error', severity: 'critical', message: `캡처 실패: ${cap.error}`, source: 'structural' }];
  }

  const findings: PartialFinding[] = [];

  if (tc.type === 'flow' && cap.flowOk === false) {
    findings.push({ caseId: tc.id, category: 'flow-failed', severity: 'major', message: '플로우 일부 단계 실패', source: 'structural' });
  }

  return findings;
}
