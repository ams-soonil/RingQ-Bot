import Anthropic from '@anthropic-ai/sdk';
import type { FigmaExtract } from '../figma/client.js';
import type { CaseLLM, LlmCaseDraft } from './types.js';

const SYSTEM = `당신은 QA 엔지니어입니다. 주어진 Figma 화면 데이터로 테스트 케이스 초안을 만듭니다.
- 각 프레임마다 'ui' 케이스를 1개 만들어 화면에 보여야 할 텍스트/요소를 적습니다.
- 'flow' 케이스는 제공된 transitions(프로토타입 연결)에 근거할 때만 만듭니다. 연결이 없으면 플로우를 지어내지 마십시오.
- 한국어 title을 씁니다.`;

const EMIT_TOOL = {
  name: 'emit_cases',
  description: '생성한 테스트 케이스 초안을 반환',
  input_schema: {
    type: 'object' as const,
    properties: {
      cases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['ui', 'flow'] },
            title: { type: 'string' },
            figmaNodeId: { type: 'string' },
            texts: { type: 'array', items: { type: 'string' } },
            elements: { type: 'array', items: { type: 'string' } },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string' },
                  target: { type: 'string' },
                  note: { type: 'string' },
                },
                required: ['action', 'target'],
              },
            },
          },
          required: ['type', 'title'],
        },
      },
    },
    required: ['cases'],
  },
};

export function createAnthropicLLM(opts: { apiKey: string; model?: string }): CaseLLM {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-6';

  return {
    async proposeCases(extract: FigmaExtract): Promise<LlmCaseDraft[]> {
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM,
        tools: [EMIT_TOOL],
        tool_choice: { type: 'tool', name: 'emit_cases' },
        messages: [{ role: 'user', content: JSON.stringify(extract) }],
      });
      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('LLM이 emit_cases 툴을 호출하지 않음');
      }
      return (block.input as { cases: LlmCaseDraft[] }).cases ?? [];
    },
  };
}
