import type { VisionFinding, VisionLLM } from './vision-types.js';

export function createFakeVision(findings: VisionFinding[]): VisionLLM {
  return {
    async compare() {
      return findings;
    },
  };
}
