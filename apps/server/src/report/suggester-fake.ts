import type { FixSuggester } from './suggester-types.js';

export function createFakeSuggester(text: string): FixSuggester {
  return {
    async suggest() {
      return text;
    },
  };
}
