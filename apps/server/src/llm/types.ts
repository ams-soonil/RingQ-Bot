import type { FigmaExtract } from '../figma/client.js';

export interface LlmCaseDraft {
  type: 'ui' | 'flow';
  title: string;
  figmaNodeId?: string;
  texts?: string[];
  elements?: string[];
  steps?: { action: string; target: string; note?: string }[];
}

export interface CaseLLM {
  proposeCases(extract: FigmaExtract): Promise<LlmCaseDraft[]>;
}
