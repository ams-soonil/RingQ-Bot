import type { Severity, UiExpectation } from '@ringq/shared';

export interface VisionFinding {
  category: string;
  severity: Severity;
  message: string;
}

export interface VisionInput {
  title: string;
  figmaImageUrl: string;
  screenshotPath: string;
  expectation?: UiExpectation;
}

export interface VisionLLM {
  compare(input: VisionInput): Promise<VisionFinding[]>;
}
