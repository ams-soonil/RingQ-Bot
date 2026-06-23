import type { CaseLLM, LlmCaseDraft } from './types.js';

export function createFakeLLM(drafts: LlmCaseDraft[]): CaseLLM {
  return {
    async proposeCases() {
      return drafts;
    },
  };
}
