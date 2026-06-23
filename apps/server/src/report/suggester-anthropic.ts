import Anthropic from '@anthropic-ai/sdk';
import type { Finding, TestCase } from '@ringq/shared';
import type { FixSuggester } from './suggester-types.js';

const SYSTEM = `당신은 시니어 프론트엔드 엔지니어입니다. QA가 발견한 결함 목록을 보고, 개발자가 무엇을 어떻게 고치면 좋을지 한국어로 간결한 수정 가이드를 제시하세요. 실제 코드 파일은 제공되지 않으니, 결함 유형별로 점검·수정 방향을 제안하면 됩니다. 마크다운 불릿으로 정리하세요.`;

export function createAnthropicSuggester(opts: { apiKey: string; model?: string }): FixSuggester {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-6';
  return {
    async suggest(findings: Finding[], cases: TestCase[]): Promise<string> {
      const caseTitle = new Map(cases.map((c) => [c.id, c.title]));
      const lines = findings.map(
        (f) => `- [${f.severity}/${f.category}] (${caseTitle.get(f.caseId) ?? f.caseId}) ${f.message}`,
      );
      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: `다음 결함들에 대한 수정 가이드를 작성하세요:\n${lines.join('\n')}` }],
      });
      const text = res.content.find((b) => b.type === 'text');
      return text && text.type === 'text' ? text.text : '';
    },
  };
}
