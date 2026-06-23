import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { VisionFinding, VisionInput, VisionLLM } from './vision-types.js';

const SYSTEM = `당신은 QA 디자인 리뷰어입니다. 첫 번째 이미지는 Figma 기획(정답지), 두 번째 이미지는 실제 구현 화면입니다.
두 화면의 레이아웃·색·간격·요소 배치 차이를 찾아 finding으로 보고하세요. 차이가 사소하면 minor, 기능/가독성에 영향이면 major, 화면이 크게 어긋나면 critical로 severity를 매깁니다. 차이가 없으면 빈 배열.`;

const EMIT_TOOL = {
  name: 'emit_findings',
  description: '발견한 시각적 차이를 보고',
  input_schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
            message: { type: 'string' },
          },
          required: ['category', 'severity', 'message'],
        },
      },
    },
    required: ['findings'],
  },
};

async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

export function createAnthropicVision(opts: { apiKey: string; model?: string }): VisionLLM {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-6';

  return {
    async compare(input: VisionInput): Promise<VisionFinding[]> {
      const figmaB64 = await urlToBase64(input.figmaImageUrl);
      const shotB64 = readFileSync(input.screenshotPath).toString('base64');

      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM,
        tools: [EMIT_TOOL],
        tool_choice: { type: 'tool', name: 'emit_findings' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `화면: ${input.title}` },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: figmaB64 } },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shotB64 } },
            ],
          },
        ],
      });

      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') return [];
      const parsed = block.input as { findings?: VisionFinding[] };
      return parsed.findings ?? [];
    },
  };
}
