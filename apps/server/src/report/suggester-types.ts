import type { Finding, TestCase } from '@ringq/shared';

export interface FixSuggester {
  suggest(findings: Finding[], cases: TestCase[]): Promise<string>;
}
