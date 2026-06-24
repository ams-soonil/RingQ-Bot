import { existsSync, readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { VisionFinding, VisionInput, VisionLLM } from './vision-types.js';

const SYSTEM = `당신은 QA 리뷰어입니다. 화면설계서의 "설계 디스크립션"을 1차 기준으로, 실제 구현 화면이 설계를 충족하는지 항목별로 판정합니다.

[입력]
- 설계 디스크립션: 이 화면이 무엇이고 무엇을 담아야 하는지 설명하는 설계서 텍스트.
- 실제 화면: 추출된 텍스트/요소 목록과(있으면) 스크린샷, 그리고(있으면) Figma 기획 이미지.

[진행 방식]
1) 먼저 관련성 판정: 실제 화면이 이 설계 화면에 "해당하는 화면"이 아니면(예: 다른 메뉴/페이지) findings를 빈 배열로 반환하라.
2) 해당하면, 설계 디스크립션을 "요구 항목" 단위로 하나씩 점검하라(예: 사이드바, 헤더, 필터 영역, 상태 탭, 리스트 테이블, 페이지네이션, 각 버튼 등).
3) 각 항목마다 finding 1건을 만들고 severity를 다음 4단계 중 하나로 매겨라:
   - "success": 기획서와 동일하게 충족됨 (성공인 항목도 반드시 보고하라)
   - "improvement": 기능 영향 없는 경미한 시각 차이(여백·색상·간격·폰트 등)
   - "warning": 기능 또는 가독성에 영향
   - "issue": 핵심 기능 누락, 화면 깨짐, 검증 불가
4) 다음은 점검 대상에서 제외(설계서 메타/장식): 화면 ID, 화면명, 화면경로, 와이어프레임 표기(WEB WIREFRAME, Copyright 등), 조건부로만 뜨는 다이얼로그/토스트 문구.
5) 텍스트는 글자 그대로가 아니라 "의미상 그 기능/영역이 있는지"로 본다. 디자인(레이아웃/색/간격)은 보조 근거로만.
6) message에는 어떤 항목을 어떻게 판정했는지 한국어로 간결히 쓴다. category는 항목 영역명(예: sidebar, header, filter, tab, table, pagination, button 등).`;

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
            severity: { type: 'string', enum: ['success', 'improvement', 'warning', 'issue'] },
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
