import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { FigmaExtract } from '../figma/client.js';
import type { CaseLLM, LlmCaseDraft } from './types.js';

const LlmOutputSchema = z.object({
  cases: z.array(z.object({
    type: z.enum(['ui', 'flow']),
    title: z.string(),
    figmaNodeId: z.string().optional(),
    texts: z.array(z.string()).optional(),
    elements: z.array(z.string()).optional(),
    steps: z.array(z.object({
      action: z.string(),
      target: z.string(),
      note: z.string().optional(),
    })).optional(),
  })),
});

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
        // 프레임이 많은 설계도는 케이스(texts/elements 포함) 출력이 길어 4096으로는
        // tool_use JSON이 잘려 cases가 비어버린다(zod "cases Required"). 넉넉히 확보.
        max_tokens: 16384,
        system: SYSTEM,
        tools: [EMIT_TOOL],
        tool_choice: { type: 'tool', name: 'emit_cases' },
        messages: [{ role: 'user', content: JSON.stringify(extract) }],
      });
      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('LLM이 emit_cases 툴을 호출하지 않음');
      }
      // 출력이 잘리면(max_tokens) tool_use input이 불완전해 cases가 빈다 → 원인을 명확히.
      if (res.stop_reason === 'max_tokens') {
        throw new Error('LLM 출력이 max_tokens로 잘렸습니다(케이스가 너무 많음). 한도를 더 늘리거나 설계 범위를 줄이세요.');
      }
      const parsed = LlmOutputSchema.safeParse(block.input);
      if (!parsed.success) {
        throw new Error(`LLM 출력 형식이 올바르지 않음: ${parsed.error.message}`);
      }
      return parsed.data.cases;
    },
  };
}
