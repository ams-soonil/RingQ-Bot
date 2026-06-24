import { existsSync, readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { VisionFinding, VisionInput, VisionLLM } from './vision-types.js';

const SYSTEM = `당신은 QA 리뷰어입니다. 화면설계서의 "설계 디스크립션"을 1차 기준으로, 실제 구현 화면이 그 설계를 충족하는지 판단합니다.

[입력]
- 설계 디스크립션: 이 화면이 무엇이고 무엇을 담아야 하는지 설명하는 설계서 텍스트.
- 실제 화면: 추출된 텍스트/요소 목록과(있으면) 스크린샷, 그리고(있으면) Figma 기획 이미지.

[판단 원칙]
1) 먼저 관련성 판정: 실제 화면이 이 설계 화면에 "해당하는 화면"이 아니면(예: 다른 메뉴/페이지) findings를 빈 배열로 반환하라. 불일치로 보고하지 마라.
2) 해당하는 화면이면, 설계 디스크립션이 요구하는 핵심 구성/동작이 실제 화면에 실제로 빠졌거나 어긋난 경우만 finding으로 보고하라.
3) 다음은 보고하지 마라(설계서 메타/장식이며 실제 화면에 없는 게 정상): 화면 ID, 화면명, 화면경로, 와이어프레임 표기(WEB WIREFRAME, Copyright 등), 조건부로만 뜨는 다이얼로그/토스트 문구.
4) 텍스트는 글자 그대로의 일치가 아니라 "의미상 그 기능/영역이 있는지"로 본다. 디자인(레이아웃/색/간격)은 보조 근거로만.
5) severity: 핵심 기능 누락/심각한 어긋남 critical, 기능·가독성 영향 major, 사소한 차이 minor. 충족하면 빈 배열.`;

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
      type Block =
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };
      const content: Block[] = [];
      content.push({
        type: 'text',
        text:
          `화면: ${input.title}\n\n` +
          `[설계 디스크립션]\n${input.description ?? '(없음)'}\n\n` +
          `[실제 화면 텍스트]\n${(input.actualTexts ?? []).join(' | ') || '(없음)'}\n\n` +
          `[실제 화면 요소]\n${(input.actualElements ?? []).join(' | ') || '(없음)'}`,
      });
      // 보조: Figma 기획 이미지(있으면) + 실제 스크린샷(있으면)
      if (input.figmaImageUrl) {
        const figmaB64 = await urlToBase64(input.figmaImageUrl);
        content.push({ type: 'text', text: '[Figma 기획 이미지]' });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: figmaB64 } });
      }
      if (input.screenshotPath && existsSync(input.screenshotPath)) {
        const shotB64 = readFileSync(input.screenshotPath).toString('base64');
        content.push({ type: 'text', text: '[실제 화면 스크린샷]' });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shotB64 } });
      }

      const res = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM,
        tools: [EMIT_TOOL],
        tool_choice: { type: 'tool', name: 'emit_findings' },
        messages: [{ role: 'user', content }],
      });

      const block = res.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') return [];
      const parsed = block.input as { findings?: VisionFinding[] };
      return parsed.findings ?? [];
    },
  };
}
