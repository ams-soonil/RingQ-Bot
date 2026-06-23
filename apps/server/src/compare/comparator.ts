import { existsSync } from 'node:fs';
import type { Finding } from '@ringq/shared';
import type { Store } from '../store.js';
import type { FigmaClient } from '../figma/client.js';
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
      const add = (caseId: string, category: string, severity: Finding['severity'], message: string, source: Finding['source']) => {
        findings.push({ id: `fd_${runId}_${idx++}`, runId, caseId, category, severity, message, source });
      };

      // structural (always)
      for (const tc of cases) {
        const cap = capByCase.get(tc.id);
        if (!cap) continue;
        for (const f of structuralCompare(tc, cap)) {
          add(f.caseId, f.category, f.severity, f.message, 'structural');
        }
      }

      // vision (best-effort): re-fetch figma for frame images
      let imageByNode = new Map<string, string>();
      try {
        const extract = await figma.fetchExtract(run.figmaLinks[0]);
        imageByNode = new Map(extract.frames.filter((f) => f.imageUrl).map((f) => [f.nodeId, f.imageUrl!]));
      } catch {
        imageByNode = new Map(); // figma 실패 → 비전 스킵
      }

      for (const tc of cases) {
        if (tc.type !== 'ui' || !tc.figmaNodeId) continue;
        const cap = capByCase.get(tc.id);
        const figmaImageUrl = imageByNode.get(tc.figmaNodeId);
        if (!cap?.screenshotPath || !existsSync(cap.screenshotPath) || !figmaImageUrl) continue;
        try {
          const vf = await vision.compare({
            title: tc.title,
            figmaImageUrl,
            screenshotPath: cap.screenshotPath,
            expectation: tc.uiExpectation,
          });
          for (const f of vf) add(tc.id, f.category, f.severity, f.message, 'vision');
        } catch {
          // 케이스별 비전 실패는 건너뜀(부분 결과 보존)
        }
      }

      return findings;
    },
  };
}
