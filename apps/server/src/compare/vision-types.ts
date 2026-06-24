import type { Severity, UiExpectation } from '@ringq/shared';

export interface VisionFinding {
  category: string;
  severity: Severity;
  message: string;
}

export interface VisionInput {
  title: string;
  /** 설계서 화면의 디스크립션(설계 텍스트) — 비교의 1차 기준. */
  description?: string;
  /** Figma 프레임 렌더 이미지(보조: 시각/디자인 비교). 없으면 텍스트 기준만. */
  figmaImageUrl?: string;
  /** 실제 화면 스크린샷 경로(보조). */
  screenshotPath?: string;
  /** 실제 화면에서 추출한 텍스트/요소(디스크립션 충족 판단용). */
  actualTexts?: string[];
  actualElements?: string[];
  expectation?: UiExpectation;
}

export interface VisionLLM {
  compare(input: VisionInput): Promise<VisionFinding[]>;
}
