import type { Finding } from '@ringq/shared';
import type { Store } from '../store.js';
import type { FigmaClient, FigmaFrame } from '../figma/client.js';
import type { VisionLLM } from './vision-types.js';
import { structuralCompare } from './structural.js';

export interface Comparator {
  compare(runId: string): Promise<Finding[]>;
}

export function createComparator(deps: { store: Store; figma: FigmaClient; vision: VisionLLM }): Comparator {
  const { store, figma, vision } = deps;

  return {
    async compare(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      const cases = store.listCases(runId).filter((c) => c.status === 'confirmed');
      const capByCase = new Map(store.listCaptures(runId).map((c) => [c.caseId, c]));

      const findings: Finding[] = [];
      let idx = 0;
      const add = (f: Omit<Finding, 'id' | 'runId'>) => {
        findings.push({ id: `fd_${runId}_${idx++}`, runId, ...f });
      };

      // 구조 비교(항상): 캡처 실패·플로우 실패 같은 확실한 사실만.
      for (const tc of cases) {
        const cap = capByCase.get(tc.id);
        if (!cap) continue;
        for (const f of structuralCompare(tc, cap)) {
          add(f);
        }
      }

      // 디스크립션 기반 비교(메인, 베스트에포트): 설계 텍스트를 재조회해 각 화면의
      // 디스크립션을 LLM에 주고, 실제 캡처(텍스트/요소+스크린샷)와 의미 단위로 비교.
      let frameByNode = new Map<string, FigmaFrame>();
      try {
        const extract = await figma.fetchExtract(run.figmaLinks[0]);
        frameByNode = new Map(extract.frames.map((f) => [f.nodeId, f]));
      } catch {
        frameByNode = new Map(); // figma 재조회 실패 → 디스크립션 비교 스킵(구조 결과만)
      }

      for (const tc of cases) {
        if (tc.type !== 'ui' || !tc.figmaNodeId) continue;
        const frame = frameByNode.get(tc.figmaNodeId);
        const cap = capByCase.get(tc.id);
        if (!frame || !cap) continue; // 설계 디스크립션 또는 실제 캡처가 없으면 비교 불가
        const description = [frame.name, ...frame.texts].filter(Boolean).join('\n');
        try {
          const input = {
            title: tc.title,
            description,
            figmaImageUrl: frame.imageUrl,
            screenshotPath: cap.screenshotPath,
            actualTexts: cap.texts,
            actualElements: cap.elements,
            expectation: tc.uiExpectation,
          };
          // LLM이 가끔 빈 결과를 주는 비결정성 대응: 비면 1회 재시도.
          let vf = await vision.compare(input);
          if (vf.length === 0) vf = await vision.compare(input);
          for (const f of vf)
            add({
              caseId: tc.id,
              category: f.category,
              severity: f.severity,
              title: f.title,
              message: f.message,
              fix: f.fix,
              source: 'vision',
            });
        } catch {
          // 케이스별 LLM 실패는 건너뜀(부분 결과 보존)
        }
      }

      return findings;
    },
  };
}
