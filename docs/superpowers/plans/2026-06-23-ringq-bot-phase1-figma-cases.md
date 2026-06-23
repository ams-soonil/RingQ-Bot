# RingQ-Bot Plan 2 · Phase 1 (Figma 분석 + 케이스 자동생성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스켈레톤의 `generating-cases` 스텁을 실제로 구현한다 — Figma REST API로 디자인을 분석해 테스트 케이스 초안을 자동 생성(Claude)하고, Run을 `awaiting-review`에서 일시정지시켜 사용자가 대시보드에서 케이스를 검수·수정·추가·확정하면 나머지 Phase(스텁 유지)로 재개한다.

**Architecture:** Phase 1을 두 단계 잡으로 분리한다. (1) `generate` 잡: figma-client가 노드 트리·프로토타입 연결·이미지를 REST로 수집 → case-generator가 Claude로 케이스 초안 생성 + 결정론적 환각 방지 가드 → store에 저장 → Run `awaiting-review`. (2) 사용자가 확정하면 `resume` 잡: 나머지 Phase(running→comparing→reporting→done)는 Plan 1 스텁 유지. 큐 핸들러는 Run의 현재 phase를 보고 어느 단계를 실행할지 결정하므로 `queue.enqueue(runId)` 시그니처는 그대로다. LLM과 figma-client는 의존성 주입(인터페이스 + 테스트용 fake)으로 외부 호출 없이 테스트한다.

**Tech Stack:** 기존(@ringq/shared, Fastify, better-sqlite3, vitest, React) + `@anthropic-ai/sdk`(Claude) + Figma REST API(전역 fetch).

## Global Constraints

- 언어: TypeScript, ESM(`"type": "module"`), Node 22.
- 패키지 매니저: pnpm 10. 테스트: vitest, `src/**/*.test.ts`.
- 모든 도메인 타입은 `@ringq/shared`에서만 정의 후 import (DRY).
- 외부 호출(Figma REST, Anthropic)은 **인터페이스 뒤로 주입**하고, 테스트에서는 fake/mock으로 대체 — 테스트는 절대 실제 네트워크를 치지 않는다.
- 시크릿 절대 커밋 금지: `ANTHROPIC_API_KEY`, `FIGMA_TOKEN`은 `.env`(gitignore). `data/`, `*.db`, `dist/` 커밋 금지.
- 환각 방지 원칙: **플로우 케이스는 Figma 프로토타입 연결에서만** 결정론적으로 인정한다. LLM이 제안한 플로우라도 extract에 없는 노드를 참조하면 **버린다**. 부족한 플로우는 사용자가 검수 UI에서 수동 추가한다.
- 커밋 메시지 형식: `✨ ringq: <내용>`(신규) / `🔨 ringq: <내용>`(수정) / `🧪 ringq: <내용>`(테스트) / `📑 ringq: <내용>`(문서). Co-Authored-By 라인 포함:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Anthropic 모델 기본값: `claude-sonnet-4-6` (케이스 생성용, 비용/속도 균형). 구조화 출력은 tool-use(`tool_choice` 강제)로 받는다.

---

### Task 1: `@ringq/shared` — phase 확장 + TestCase 타입

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `RunPhaseSchema`.
- Produces:
  - `RunPhaseSchema`에 두 값 추가: `'awaiting-review'`, `'cases-confirmed'` (queued/generating-cases 다음, running 앞 순서로 삽입).
  - `TestCaseTypeSchema` = `z.enum(['ui','flow'])`, `TestCaseSourceSchema` = `z.enum(['figma','manual'])`, `TestCaseStatusSchema` = `z.enum(['draft','confirmed','rejected'])`.
  - `UiExpectationSchema` = `z.object({ texts: z.array(z.string()), elements: z.array(z.string()), colors: z.array(z.string()) })` → type `UiExpectation`.
  - `FlowStepSchema` = `z.object({ action: z.enum(['navigate','click','expect']), target: z.string(), note: z.string().optional() })` → type `FlowStep`.
  - `TestCaseSchema` = `z.object({ id, runId, type: TestCaseTypeSchema, source: TestCaseSourceSchema, status: TestCaseStatusSchema, title: z.string(), figmaNodeId: z.string().optional(), uiExpectation: UiExpectationSchema.optional(), steps: z.array(FlowStepSchema).optional(), confidence: z.number().min(0).max(1).optional() })` → type `TestCase`.

- [ ] **Step 1: 실패하는 테스트 추가** — `packages/shared/src/index.test.ts` 끝에 append

```ts
import { RunPhaseSchema, TestCaseSchema } from './index.js';

describe('RunPhaseSchema 확장', () => {
  it('awaiting-review와 cases-confirmed를 허용한다', () => {
    expect(RunPhaseSchema.parse('awaiting-review')).toBe('awaiting-review');
    expect(RunPhaseSchema.parse('cases-confirmed')).toBe('cases-confirmed');
  });
});

describe('TestCaseSchema', () => {
  it('UI 케이스를 검증한다', () => {
    const c = TestCaseSchema.parse({
      id: 'tc_1',
      runId: 'run_1',
      type: 'ui',
      source: 'figma',
      status: 'draft',
      title: '로그인 화면 UI',
      figmaNodeId: '1:2',
      uiExpectation: { texts: ['로그인'], elements: ['button'], colors: ['#ff0000'] },
    });
    expect(c.type).toBe('ui');
  });

  it('flow 케이스의 step action을 검증한다', () => {
    const c = TestCaseSchema.parse({
      id: 'tc_2',
      runId: 'run_1',
      type: 'flow',
      source: 'manual',
      status: 'draft',
      title: '로그인 플로우',
      steps: [{ action: 'click', target: '로그인 버튼' }],
    });
    expect(c.steps?.[0].action).toBe('click');
  });

  it('잘못된 step action을 거부한다', () => {
    expect(() =>
      TestCaseSchema.parse({
        id: 'tc_3',
        runId: 'run_1',
        type: 'flow',
        source: 'manual',
        status: 'draft',
        title: 'x',
        steps: [{ action: 'teleport', target: 'x' }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: FAIL — `TestCaseSchema` export 없음, awaiting-review 파싱 실패.

- [ ] **Step 3: 구현** — `packages/shared/src/index.ts`의 `RunPhaseSchema`를 교체하고 파일 끝에 타입 추가

`RunPhaseSchema`를 다음으로 교체:

```ts
export const RunPhaseSchema = z.enum([
  'queued',
  'generating-cases',
  'awaiting-review',
  'cases-confirmed',
  'running',
  'comparing',
  'reporting',
  'done',
  'failed',
]);
```

파일 끝(ProgressEvent 정의 뒤)에 추가:

```ts
export const TestCaseTypeSchema = z.enum(['ui', 'flow']);
export type TestCaseType = z.infer<typeof TestCaseTypeSchema>;

export const TestCaseSourceSchema = z.enum(['figma', 'manual']);
export type TestCaseSource = z.infer<typeof TestCaseSourceSchema>;

export const TestCaseStatusSchema = z.enum(['draft', 'confirmed', 'rejected']);
export type TestCaseStatus = z.infer<typeof TestCaseStatusSchema>;

export const UiExpectationSchema = z.object({
  texts: z.array(z.string()),
  elements: z.array(z.string()),
  colors: z.array(z.string()),
});
export type UiExpectation = z.infer<typeof UiExpectationSchema>;

export const FlowStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'expect']),
  target: z.string(),
  note: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: TestCaseTypeSchema,
  source: TestCaseSourceSchema,
  status: TestCaseStatusSchema,
  title: z.string(),
  figmaNodeId: z.string().optional(),
  uiExpectation: UiExpectationSchema.optional(),
  steps: z.array(FlowStepSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: PASS (기존 4 + 신규 4 = 8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "$(printf '✨ ringq: shared에 awaiting-review/cases-confirmed phase + TestCase 타입 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `figma-client` — URL 파싱 + REST fetch + 구조 추출

**Files:**
- Create: `apps/server/src/figma/client.ts`
- Create: `apps/server/src/figma/fixtures/nodes.sample.json` (테스트 fixture)
- Test: `apps/server/src/figma/client.test.ts`

**Interfaces:**
- Consumes: 없음(@ringq/shared 불필요). `fetch`는 주입 가능하게 받는다.
- Produces:
  - `parseFigmaUrl(url: string): { fileKey: string; nodeIds: string[] }` — `https://www.figma.com/file/<KEY>/...?node-id=1-2` 또는 `/design/<KEY>/...` 형식 모두 지원. `node-id`의 `1-2`를 `1:2`로 정규화. node-id 없으면 `nodeIds: []`.
  - 내부 추출 타입(export):
    - `FigmaElement = { type: string; name: string; text?: string }`
    - `FigmaFrame = { nodeId: string; name: string; texts: string[]; elements: FigmaElement[]; colors: string[]; imageUrl?: string }`
    - `FigmaTransition = { fromNodeId: string; toNodeId: string; trigger: string }`
    - `FigmaExtract = { fileKey: string; frames: FigmaFrame[]; transitions: FigmaTransition[] }`
  - `createFigmaClient(opts: { token: string; fetchImpl?: typeof fetch }): FigmaClient`
  - `FigmaClient.fetchExtract(url: string): Promise<FigmaExtract>` — URL 파싱 → `/v1/files/{key}/nodes?ids=...&depth=6`로 노드 트리, `/v1/images/{key}?ids=...&format=png&scale=2`로 이미지 URL을 받아 `FigmaExtract`로 변환. 토큰은 `X-Figma-Token` 헤더. 응답 비정상(status!=200)이면 `Error('figma API <status>: <text>')` throw.
  - 추출 규칙: 노드 트리를 재귀 순회하며 `type==='TEXT'` 노드의 `characters`를 해당 프레임의 `texts`에, fills의 SOLID 색을 hex로 `colors`에(중복 제거), 컴포넌트/인스턴스/프레임 자식 중 이름이 버튼/입력 등인 노드를 `elements`에 모은다. `interactions`(또는 `transitionNodeID`)가 있는 노드는 `transitions`로 수집(`trigger`는 interaction의 trigger.type, 없으면 `'ON_CLICK'`).

- [ ] **Step 1: fixture 작성** — `apps/server/src/figma/fixtures/nodes.sample.json`

```json
{
  "nodes": {
    "1:2": {
      "document": {
        "id": "1:2",
        "name": "로그인",
        "type": "FRAME",
        "children": [
          { "id": "1:3", "name": "제목", "type": "TEXT", "characters": "로그인",
            "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 0, "b": 0 } }] },
          { "id": "1:4", "name": "로그인 버튼", "type": "INSTANCE", "children": [],
            "interactions": [
              { "trigger": { "type": "ON_CLICK" },
                "actions": [{ "type": "NODE", "destinationId": "1:9" }] }
            ] }
        ]
      }
    },
    "1:9": {
      "document": {
        "id": "1:9",
        "name": "홈",
        "type": "FRAME",
        "children": [
          { "id": "1:10", "name": "환영문구", "type": "TEXT", "characters": "환영합니다" }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `apps/server/src/figma/client.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFigmaUrl, createFigmaClient } from './client.js';

const nodesSample = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/nodes.sample.json', import.meta.url)), 'utf8'),
);

describe('parseFigmaUrl', () => {
  it('fileKey와 node-id를 파싱하고 1-2를 1:2로 정규화한다', () => {
    const r = parseFigmaUrl('https://www.figma.com/file/ABC123/My?node-id=1-2');
    expect(r.fileKey).toBe('ABC123');
    expect(r.nodeIds).toEqual(['1:2']);
  });

  it('/design/ 경로도 지원한다', () => {
    const r = parseFigmaUrl('https://www.figma.com/design/XYZ/Proj?node-id=10-20&t=x');
    expect(r.fileKey).toBe('XYZ');
    expect(r.nodeIds).toEqual(['10:20']);
  });

  it('node-id가 없으면 빈 배열', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/ABC/My').nodeIds).toEqual([]);
  });
});

describe('FigmaClient.fetchExtract', () => {
  it('노드 트리와 이미지를 받아 프레임/전환을 추출한다', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/v1/files/')) {
        return { ok: true, status: 200, json: async () => nodesSample } as Response;
      }
      if (url.includes('/v1/images/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ images: { '1:2': 'https://img/1-2.png', '1:9': 'https://img/1-9.png' } }),
        } as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = createFigmaClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    const extract = await client.fetchExtract('https://www.figma.com/file/ABC123/My?node-id=1-2');

    expect(extract.fileKey).toBe('ABC123');
    const login = extract.frames.find((f) => f.nodeId === '1:2')!;
    expect(login.name).toBe('로그인');
    expect(login.texts).toContain('로그인');
    expect(login.colors).toContain('#ff0000');
    expect(login.elements.map((e) => e.name)).toContain('로그인 버튼');
    expect(login.imageUrl).toBe('https://img/1-2.png');
    expect(extract.transitions).toContainEqual({ fromNodeId: '1:4', toNodeId: '1:9', trigger: 'ON_CLICK' });
    // X-Figma-Token 헤더 전송 확인
    const firstCall = fetchImpl.mock.calls[0];
    expect((firstCall[1] as RequestInit).headers).toMatchObject({ 'X-Figma-Token': 't' });
  });

  it('figma API 오류 시 throw한다', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) as Response);
    const client = createFigmaClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      client.fetchExtract('https://www.figma.com/file/ABC/My?node-id=1-2'),
    ).rejects.toThrow(/figma API 403/);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test figma`
Expected: FAIL — `./client.js` 없음.

- [ ] **Step 4: 구현** — `apps/server/src/figma/client.ts`

```ts
export interface FigmaElement {
  type: string;
  name: string;
  text?: string;
}
export interface FigmaFrame {
  nodeId: string;
  name: string;
  texts: string[];
  elements: FigmaElement[];
  colors: string[];
  imageUrl?: string;
}
export interface FigmaTransition {
  fromNodeId: string;
  toNodeId: string;
  trigger: string;
}
export interface FigmaExtract {
  fileKey: string;
  frames: FigmaFrame[];
  transitions: FigmaTransition[];
}

export interface FigmaClient {
  fetchExtract(url: string): Promise<FigmaExtract>;
}

const ELEMENT_TYPES = new Set(['INSTANCE', 'COMPONENT']);
const ELEMENT_NAME_HINT = /(버튼|button|입력|input|field|체크|toggle|링크|link|아이콘|icon)/i;

export function parseFigmaUrl(url: string): { fileKey: string; nodeIds: string[] } {
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error(`Figma URL 형식이 아님: ${url}`);
  const fileKey = m[1];
  const u = new URL(url);
  const raw = u.searchParams.get('node-id');
  const nodeIds = raw ? [raw.replace(/-/g, ':')] : [];
  return { fileKey, nodeIds };
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

interface RawNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  fills?: { type: string; color?: { r: number; g: number; b: number } }[];
  children?: RawNode[];
  interactions?: { trigger?: { type?: string }; actions?: { destinationId?: string }[] }[];
  transitionNodeID?: string;
}

function walk(
  node: RawNode,
  frame: FigmaFrame,
  transitions: FigmaTransition[],
): void {
  if (node.type === 'TEXT' && node.characters) {
    frame.texts.push(node.characters);
  }
  for (const fill of node.fills ?? []) {
    if (fill.type === 'SOLID' && fill.color) {
      const hex = rgbToHex(fill.color);
      if (!frame.colors.includes(hex)) frame.colors.push(hex);
    }
  }
  if (ELEMENT_TYPES.has(node.type) || ELEMENT_NAME_HINT.test(node.name)) {
    frame.elements.push({ type: node.type, name: node.name, text: node.characters });
  }
  for (const inter of node.interactions ?? []) {
    const dest = inter.actions?.find((a) => a.destinationId)?.destinationId;
    if (dest) {
      transitions.push({ fromNodeId: node.id, toNodeId: dest, trigger: inter.trigger?.type ?? 'ON_CLICK' });
    }
  }
  if (node.transitionNodeID) {
    transitions.push({ fromNodeId: node.id, toNodeId: node.transitionNodeID, trigger: 'ON_CLICK' });
  }
  for (const child of node.children ?? []) walk(child, frame, transitions);
}

export function createFigmaClient(opts: { token: string; fetchImpl?: typeof fetch }): FigmaClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { 'X-Figma-Token': opts.token };

  return {
    async fetchExtract(url) {
      const { fileKey, nodeIds } = parseFigmaUrl(url);
      const ids = nodeIds.join(',');

      const nodesRes = await doFetch(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids}&depth=6`,
        { headers },
      );
      if (!nodesRes.ok) {
        throw new Error(`figma API ${nodesRes.status}: ${await nodesRes.text()}`);
      }
      const nodesBody = (await nodesRes.json()) as {
        nodes: Record<string, { document: RawNode }>;
      };

      let images: Record<string, string> = {};
      if (ids) {
        const imgRes = await doFetch(
          `https://api.figma.com/v1/images/${fileKey}?ids=${ids}&format=png&scale=2`,
          { headers },
        );
        if (imgRes.ok) {
          images = ((await imgRes.json()) as { images: Record<string, string> }).images ?? {};
        }
      }

      const frames: FigmaFrame[] = [];
      const transitions: FigmaTransition[] = [];
      for (const [key, entry] of Object.entries(nodesBody.nodes)) {
        const doc = entry.document;
        const frame: FigmaFrame = {
          nodeId: doc.id,
          name: doc.name,
          texts: [],
          elements: [],
          colors: [],
          imageUrl: images[key] ?? images[doc.id],
        };
        walk(doc, frame, transitions);
        frames.push(frame);
      }

      return { fileKey, frames, transitions };
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test figma`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/figma
git commit -m "$(printf '✨ ringq: figma-client(REST 노드/이미지 fetch + 구조 추출) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `llm` — Anthropic 케이스 제안 클라이언트 + fake

**Files:**
- Create: `apps/server/src/llm/types.ts`
- Create: `apps/server/src/llm/anthropic.ts`
- Create: `apps/server/src/llm/fake.ts`
- Test: `apps/server/src/llm/fake.test.ts`

**Interfaces:**
- Consumes: `FigmaExtract`(Task 2).
- Produces:
  - `types.ts`:
    - `LlmCaseDraft = { type: 'ui' | 'flow'; title: string; figmaNodeId?: string; texts?: string[]; elements?: string[]; steps?: { action: string; target: string; note?: string }[]; }`
    - `CaseLLM = { proposeCases(extract: FigmaExtract): Promise<LlmCaseDraft[]> }`
  - `anthropic.ts`: `createAnthropicLLM(opts: { apiKey: string; model?: string }): CaseLLM` — `@anthropic-ai/sdk`로 tool-use 강제 호출, `emit_cases` 툴의 input에서 `cases`를 반환. 기본 모델 `claude-sonnet-4-6`.
  - `fake.ts`: `createFakeLLM(drafts: LlmCaseDraft[]): CaseLLM` — 주어진 drafts를 그대로 반환(테스트/오프라인용).

- [ ] **Step 1: 의존성 추가** — `apps/server/package.json`의 dependencies에 `"@anthropic-ai/sdk": "^0.32.0"` 추가 후

Run: `pnpm install`
Expected: SDK 설치 완료.

- [ ] **Step 2: 타입 작성** — `apps/server/src/llm/types.ts`

```ts
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
```

- [ ] **Step 3: fake 작성** — `apps/server/src/llm/fake.ts`

```ts
import type { CaseLLM, LlmCaseDraft } from './types.js';

export function createFakeLLM(drafts: LlmCaseDraft[]): CaseLLM {
  return {
    async proposeCases() {
      return drafts;
    },
  };
}
```

- [ ] **Step 4: 실패하는 테스트 작성** — `apps/server/src/llm/fake.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createFakeLLM } from './fake.js';
import type { LlmCaseDraft } from './types.js';

describe('fake LLM', () => {
  it('주어진 drafts를 그대로 반환한다', async () => {
    const drafts: LlmCaseDraft[] = [{ type: 'ui', title: '로그인 UI', figmaNodeId: '1:2' }];
    const llm = createFakeLLM(drafts);
    const extract = { fileKey: 'x', frames: [], transitions: [] };
    expect(await llm.proposeCases(extract)).toEqual(drafts);
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test llm`
Expected: FAIL — `./fake.js` 없음.

- [ ] **Step 6: Anthropic 구현** — `apps/server/src/llm/anthropic.ts`

```ts
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
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test llm`
Expected: PASS (1 test). (anthropic.ts는 타입 컴파일만 검증; 실제 호출 테스트 없음 — 외부 의존이므로 fake로 대체.)

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/llm apps/server/package.json pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: LLM 케이스 제안 클라이언트(Anthropic tool-use) + fake 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: `case-generator` — LLM 제안 + 결정론적 환각 방지 가드

**Files:**
- Create: `apps/server/src/cases/generator.ts`
- Test: `apps/server/src/cases/generator.test.ts`

**Interfaces:**
- Consumes: `FigmaExtract`(Task 2), `CaseLLM`/`LlmCaseDraft`(Task 3), `@ringq/shared`의 `TestCase`.
- Produces:
  - `createCaseGenerator(llm: CaseLLM): CaseGenerator`
  - `CaseGenerator.generate(runId: string, extract: FigmaExtract): Promise<TestCase[]>`
  - 규칙:
    1. `llm.proposeCases(extract)`로 초안을 받는다.
    2. **환각 방지 가드**: `flow` 초안은 모든 step의 `target`이 extract의 알려진 식별자(프레임 name 또는 nodeId, element name)와 매칭될 때만 인정. 하나라도 미매칭이면 그 flow 케이스는 **버린다**.
    3. step의 `action`이 `'navigate'|'click'|'expect'`가 아니면 그 step은 버리고, 남은 step이 0개면 케이스도 버린다.
    4. **UI 케이스 보장**: extract의 각 프레임에 대해 `type==='ui'`이고 그 `figmaNodeId`를 가진 케이스가 없으면, 프레임의 texts/elements/colors로 기본 UI 케이스를 추가한다.
    5. 모든 케이스에 `id`(`tc_<runId>_<index>`), `runId`, `source: 'figma'`, `status: 'draft'` 부여. UI 케이스는 초안의 texts/elements와 프레임의 colors로 `uiExpectation` 구성.
    6. 반환 전 각 케이스를 `TestCaseSchema.parse`로 검증.

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/cases/generator.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createCaseGenerator } from './generator.js';
import { createFakeLLM } from '../llm/fake.js';
import type { FigmaExtract } from '../figma/client.js';

const extract: FigmaExtract = {
  fileKey: 'ABC',
  frames: [
    { nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [{ type: 'INSTANCE', name: '로그인 버튼' }], colors: ['#ff0000'] },
    { nodeId: '1:9', name: '홈', texts: ['환영합니다'], elements: [], colors: [] },
  ],
  transitions: [{ fromNodeId: '1:4', toNodeId: '1:9', trigger: 'ON_CLICK' }],
};

describe('case generator', () => {
  it('유효한 flow 초안은 유지하고 환각 flow는 버린다', async () => {
    const llm = createFakeLLM([
      { type: 'flow', title: '로그인 플로우', steps: [{ action: 'click', target: '로그인 버튼' }, { action: 'navigate', target: '홈' }] },
      { type: 'flow', title: '환각 플로우', steps: [{ action: 'click', target: '존재하지않는화면' }] },
    ]);
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);

    const flows = cases.filter((c) => c.type === 'flow');
    expect(flows.map((f) => f.title)).toContain('로그인 플로우');
    expect(flows.map((f) => f.title)).not.toContain('환각 플로우');
  });

  it('LLM이 UI 케이스를 안 줘도 프레임마다 기본 UI 케이스를 보장한다', async () => {
    const llm = createFakeLLM([]); // 아무 초안 없음
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);

    const ui = cases.filter((c) => c.type === 'ui');
    expect(ui.map((c) => c.figmaNodeId).sort()).toEqual(['1:2', '1:9']);
    const login = ui.find((c) => c.figmaNodeId === '1:2')!;
    expect(login.uiExpectation?.texts).toContain('로그인');
    expect(login.uiExpectation?.colors).toContain('#ff0000');
    expect(login.source).toBe('figma');
    expect(login.status).toBe('draft');
    expect(login.id).toMatch(/^tc_run_1_/);
  });

  it('잘못된 action만 제거하고 남은 step이 0이면 케이스를 버린다', async () => {
    const llm = createFakeLLM([
      { type: 'flow', title: '깨진 플로우', steps: [{ action: 'teleport', target: '로그인' }] },
    ]);
    const gen = createCaseGenerator(llm);
    const cases = await gen.generate('run_1', extract);
    expect(cases.filter((c) => c.title === '깨진 플로우')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test generator`
Expected: FAIL — `./generator.js` 없음.

- [ ] **Step 3: 구현** — `apps/server/src/cases/generator.ts`

```ts
import { TestCaseSchema, type FlowStep, type TestCase } from '@ringq/shared';
import type { FigmaExtract } from '../figma/client.js';
import type { CaseLLM } from '../llm/types.js';

export interface CaseGenerator {
  generate(runId: string, extract: FigmaExtract): Promise<TestCase[]>;
}

const VALID_ACTIONS = new Set(['navigate', 'click', 'expect']);

function knownTargets(extract: FigmaExtract): Set<string> {
  const set = new Set<string>();
  for (const f of extract.frames) {
    set.add(f.name);
    set.add(f.nodeId);
    for (const el of f.elements) set.add(el.name);
  }
  return set;
}

export function createCaseGenerator(llm: CaseLLM): CaseGenerator {
  return {
    async generate(runId, extract) {
      const drafts = await llm.proposeCases(extract);
      const known = knownTargets(extract);
      const cases: TestCase[] = [];
      let idx = 0;
      const nextId = () => `tc_${runId}_${idx++}`;
      const coveredUiNodes = new Set<string>();

      for (const d of drafts) {
        if (d.type === 'ui') {
          const frame = extract.frames.find((f) => f.nodeId === d.figmaNodeId);
          cases.push(
            TestCaseSchema.parse({
              id: nextId(),
              runId,
              type: 'ui',
              source: 'figma',
              status: 'draft',
              title: d.title,
              figmaNodeId: d.figmaNodeId,
              uiExpectation: {
                texts: d.texts ?? frame?.texts ?? [],
                elements: d.elements ?? frame?.elements.map((e) => e.name) ?? [],
                colors: frame?.colors ?? [],
              },
            }),
          );
          if (d.figmaNodeId) coveredUiNodes.add(d.figmaNodeId);
        } else {
          const steps: FlowStep[] = (d.steps ?? [])
            .filter((s) => VALID_ACTIONS.has(s.action) && known.has(s.target))
            .map((s) => ({ action: s.action as FlowStep['action'], target: s.target, note: s.note }));
          // 환각 방지: 원래 step 수와 살아남은 step 수가 다르면(미매칭 target 존재) 버린다.
          const originalCount = (d.steps ?? []).length;
          if (steps.length === 0 || steps.length !== originalCount) continue;
          cases.push(
            TestCaseSchema.parse({
              id: nextId(),
              runId,
              type: 'flow',
              source: 'figma',
              status: 'draft',
              title: d.title,
              steps,
            }),
          );
        }
      }

      // UI 케이스 보장: 누락 프레임에 기본 UI 케이스 추가
      for (const frame of extract.frames) {
        if (coveredUiNodes.has(frame.nodeId)) continue;
        cases.push(
          TestCaseSchema.parse({
            id: nextId(),
            runId,
            type: 'ui',
            source: 'figma',
            status: 'draft',
            title: `${frame.name} 화면 UI`,
            figmaNodeId: frame.nodeId,
            uiExpectation: {
              texts: frame.texts,
              elements: frame.elements.map((e) => e.name),
              colors: frame.colors,
            },
          }),
        );
      }

      return cases;
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test generator`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/cases
git commit -m "$(printf '✨ ringq: case-generator(LLM 제안 + 환각 방지 가드 + UI 케이스 보장) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: `store` — test_cases 영속화

**Files:**
- Modify: `apps/server/src/store.ts`
- Test: `apps/server/src/store.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `@ringq/shared`의 `TestCase`, `TestCaseStatus`.
- Produces (Store 인터페이스에 메서드 추가):
  - `saveCases(runId: string, cases: TestCase[]): void` — 해당 run의 기존 케이스를 모두 지우고 새로 저장(idempotent 재생성).
  - `listCases(runId: string): TestCase[]` — 삽입 순.
  - `updateCase(caseId: string, patch: Partial<Pick<TestCase, 'title' | 'status' | 'uiExpectation' | 'steps'>>): TestCase` — 없으면 `Error('case not found: <id>')`.
  - `addCase(testCase: TestCase): TestCase` — 수동 추가용(이미 id 포함).
  - `confirmCases(runId: string): void` — 해당 run의 모든 `draft` 케이스를 `confirmed`로 일괄 전환(이미 rejected는 유지).
  - 새 테이블 `test_cases(seq, id UNIQUE, run_id, type, source, status, title, figma_node_id, ui_expectation TEXT, steps TEXT, confidence)`; JSON 직렬화로 uiExpectation/steps 저장.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/store.test.ts` 끝에 append

```ts
import type { TestCase } from '@ringq/shared';

const uiCase: TestCase = {
  id: 'tc_1', runId: 'r1', type: 'ui', source: 'figma', status: 'draft',
  title: '로그인 UI', figmaNodeId: '1:2',
  uiExpectation: { texts: ['로그인'], elements: ['로그인 버튼'], colors: ['#ff0000'] },
};
const flowCase: TestCase = {
  id: 'tc_2', runId: 'r1', type: 'flow', source: 'figma', status: 'draft',
  title: '로그인 플로우', steps: [{ action: 'click', target: '로그인 버튼' }],
};

describe('store test_cases', () => {
  it('saveCases/listCases 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, flowCase]);
    const got = store.listCases('r1');
    expect(got).toHaveLength(2);
    expect(got[0].uiExpectation?.texts).toEqual(['로그인']);
    expect(got[1].steps?.[0].target).toBe('로그인 버튼');
  });

  it('saveCases는 기존 케이스를 교체한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, flowCase]);
    store.saveCases('r1', [uiCase]);
    expect(store.listCases('r1')).toHaveLength(1);
  });

  it('updateCase로 title/status를 갱신한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase]);
    const u = store.updateCase('tc_1', { title: '수정됨', status: 'rejected' });
    expect(u.title).toBe('수정됨');
    expect(store.listCases('r1')[0].status).toBe('rejected');
  });

  it('없는 case update는 throw', () => {
    const store = createStore(':memory:');
    expect(() => store.updateCase('nope', { title: 'x' })).toThrow(/case not found/);
  });

  it('addCase로 수동 케이스를 추가한다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase]);
    store.addCase({ ...flowCase, id: 'tc_manual', source: 'manual' });
    expect(store.listCases('r1')).toHaveLength(2);
  });

  it('confirmCases는 draft만 confirmed로 바꾼다', () => {
    const store = createStore(':memory:');
    store.saveCases('r1', [uiCase, { ...flowCase, status: 'rejected' }]);
    store.confirmCases('r1');
    const got = store.listCases('r1');
    expect(got.find((c) => c.id === 'tc_1')?.status).toBe('confirmed');
    expect(got.find((c) => c.id === 'tc_2')?.status).toBe('rejected');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test store`
Expected: FAIL — saveCases 등 메서드 없음.

- [ ] **Step 3: 구현** — `apps/server/src/store.ts` 수정

import 라인을 다음으로 교체:

```ts
import Database from 'better-sqlite3';
import type { ProjectInput, Run, RunPhase, RunStatus, TestCase } from '@ringq/shared';
```

`Store` 인터페이스에 메서드 추가(`listRuns(): Run[];` 뒤):

```ts
  saveCases(runId: string, cases: TestCase[]): void;
  listCases(runId: string): TestCase[];
  updateCase(caseId: string, patch: Partial<Pick<TestCase, 'title' | 'status' | 'uiExpectation' | 'steps'>>): TestCase;
  addCase(testCase: TestCase): TestCase;
  confirmCases(runId: string): void;
```

`runs` 테이블 생성 `db.exec(...)` 바로 뒤에 test_cases 테이블 생성 추가:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_cases (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      figma_node_id TEXT,
      ui_expectation TEXT,
      steps TEXT,
      confidence REAL
    );
  `);
```

`store.ts` 파일 상단(`rowToRun` 옆)에 case 변환 헬퍼 추가:

```ts
interface CaseRow {
  id: string;
  run_id: string;
  type: string;
  source: string;
  status: string;
  title: string;
  figma_node_id: string | null;
  ui_expectation: string | null;
  steps: string | null;
  confidence: number | null;
}

function rowToCase(row: CaseRow): TestCase {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type as TestCase['type'],
    source: row.source as TestCase['source'],
    status: row.status as TestCase['status'],
    title: row.title,
    figmaNodeId: row.figma_node_id ?? undefined,
    uiExpectation: row.ui_expectation ? JSON.parse(row.ui_expectation) : undefined,
    steps: row.steps ? JSON.parse(row.steps) : undefined,
    confidence: row.confidence ?? undefined,
  };
}
```

`return { ... }` 객체의 `listRuns()` 뒤에 메서드 추가:

```ts
    saveCases(runId, cases) {
      const del = db.prepare(`DELETE FROM test_cases WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO test_cases (id, run_id, type, source, status, title, figma_node_id, ui_expectation, steps, confidence)
         VALUES (@id, @run_id, @type, @source, @status, @title, @figma_node_id, @ui_expectation, @steps, @confidence)`,
      );
      const tx = db.transaction((rows: TestCase[]) => {
        del.run(runId);
        for (const c of rows) {
          ins.run({
            id: c.id,
            run_id: runId,
            type: c.type,
            source: c.source,
            status: c.status,
            title: c.title,
            figma_node_id: c.figmaNodeId ?? null,
            ui_expectation: c.uiExpectation ? JSON.stringify(c.uiExpectation) : null,
            steps: c.steps ? JSON.stringify(c.steps) : null,
            confidence: c.confidence ?? null,
          });
        }
      });
      tx(cases);
    },
    listCases(runId) {
      const rows = db.prepare(`SELECT * FROM test_cases WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CaseRow[];
      return rows.map(rowToCase);
    },
    updateCase(caseId, patch) {
      const row = db.prepare(`SELECT * FROM test_cases WHERE id = ?`).get(caseId) as CaseRow | undefined;
      if (!row) throw new Error(`case not found: ${caseId}`);
      const current = rowToCase(row);
      const next: TestCase = { ...current, ...patch };
      db.prepare(
        `UPDATE test_cases SET title = ?, status = ?, ui_expectation = ?, steps = ? WHERE id = ?`,
      ).run(
        next.title,
        next.status,
        next.uiExpectation ? JSON.stringify(next.uiExpectation) : null,
        next.steps ? JSON.stringify(next.steps) : null,
        caseId,
      );
      return next;
    },
    addCase(testCase) {
      db.prepare(
        `INSERT INTO test_cases (id, run_id, type, source, status, title, figma_node_id, ui_expectation, steps, confidence)
         VALUES (@id, @run_id, @type, @source, @status, @title, @figma_node_id, @ui_expectation, @steps, @confidence)`,
      ).run({
        id: testCase.id,
        run_id: testCase.runId,
        type: testCase.type,
        source: testCase.source,
        status: testCase.status,
        title: testCase.title,
        figma_node_id: testCase.figmaNodeId ?? null,
        ui_expectation: testCase.uiExpectation ? JSON.stringify(testCase.uiExpectation) : null,
        steps: testCase.steps ? JSON.stringify(testCase.steps) : null,
        confidence: testCase.confidence ?? null,
      });
      return testCase;
    },
    confirmCases(runId) {
      db.prepare(`UPDATE test_cases SET status = 'confirmed' WHERE run_id = ? AND status = 'draft'`).run(runId);
    },
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test store`
Expected: PASS (기존 5 + 신규 6 = 11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/src/store.test.ts
git commit -m "$(printf '✨ ringq: store에 test_cases 영속화(save/list/update/add/confirm) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: 파이프라인 재작성 — phase 인지형 (generate → awaiting-review → resume)

**Files:**
- Create: `apps/server/src/pipeline.ts` (기존 createSkeletonPipeline 대체 — 새 함수 export, 기존 함수는 제거)
- Test: `apps/server/src/pipeline.test.ts` (기존 테스트 대체)
- Modify: `apps/server/src/app.test.ts` (setup이 createSkeletonPipeline을 import하므로 새 파이프라인으로 갱신 — 안 하면 이 커밋에서 app 테스트가 깨짐)

**Interfaces:**
- Consumes: `Store`(Task 5), `FigmaClient`(Task 2), `CaseGenerator`(Task 4), `emitProgress`/`now`(events), `@ringq/shared`.
- Produces:
  - `createPipeline(deps: { store: Store; figma: FigmaClient; generator: CaseGenerator }, opts?: { delayMs?: number }): (runId: string) => Promise<void>`
  - 동작: 핸들러는 Run의 현재 phase로 분기한다.
    - phase가 `'queued'`(또는 `'generating-cases'`)이면 **generate 단계**: phase=`generating-cases` 진행 emit → run의 첫 figmaLink로 `figma.fetchExtract` → `generator.generate(runId, extract)` → `store.saveCases` → phase=`awaiting-review`로 전환 + emit. (여기서 잡 종료, Run은 사용자 확정 대기.)
    - phase가 `'cases-confirmed'`이면 **resume 단계**: `running → comparing → reporting`을 스텁으로 진행(각 emit, delayMs 대기) → phase=`done`/status=`done`.
    - 그 외 phase면 아무것도 안 하고 반환(방어).
  - 에러 시 phase=`failed`/status=`failed` 기록 후 emit + rethrow. (기존 동작 유지.)

- [ ] **Step 1: 기존 테스트 대체** — `apps/server/src/pipeline.test.ts` 전체 교체

```ts
import { describe, it, expect, vi } from 'vitest';
import { createStore } from './store.js';
import { createPipeline } from './pipeline.js';
import { createCaseGenerator } from './cases/generator.js';
import { createFakeLLM } from './llm/fake.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';
import type { FigmaExtract, FigmaClient } from './figma/client.js';

const extract: FigmaExtract = {
  fileKey: 'ABC',
  frames: [{ nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [], colors: ['#fff'] }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => extract };
const input = { figmaLinks: ['https://www.figma.com/file/ABC/My?node-id=1-2'], siteUrl: 'https://example.com' };

function makeDeps() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  return { store, generator, figma: fakeFigma };
}

describe('pipeline generate 단계', () => {
  it('케이스를 생성·저장하고 awaiting-review에서 멈춘다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    const phases: string[] = [];
    const listener = (ev: ProgressEvent) => phases.push(ev.phase);
    runEvents.on(run.id, listener);

    await createPipeline(deps, { delayMs: 0 })(run.id);

    runEvents.off(run.id, listener);
    expect(deps.store.getRun(run.id)!.phase).toBe('awaiting-review');
    expect(deps.store.listCases(run.id).length).toBeGreaterThan(0); // 프레임당 UI 케이스 보장
    expect(phases).toContain('generating-cases');
    expect(phases).toContain('awaiting-review');
    expect(phases).not.toContain('done');
  });
});

describe('pipeline resume 단계', () => {
  it('cases-confirmed면 나머지 스텁을 진행하고 done으로 끝낸다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    deps.store.updateRun(run.id, { phase: 'cases-confirmed' });

    await createPipeline(deps, { delayMs: 0 })(run.id);

    expect(deps.store.getRun(run.id)!.phase).toBe('done');
    expect(deps.store.getRun(run.id)!.status).toBe('done');
  });
});

describe('pipeline 에러 처리', () => {
  it('figma 실패 시 failed로 표시하고 rethrow한다', async () => {
    const deps = makeDeps();
    const failingFigma: FigmaClient = {
      fetchExtract: vi.fn(async () => {
        throw new Error('figma boom');
      }),
    };
    const run = deps.store.createRun(input);
    const p = createPipeline({ ...deps, figma: failingFigma }, { delayMs: 0 });
    await expect(p(run.id)).rejects.toThrow('figma boom');
    expect(deps.store.getRun(run.id)!.phase).toBe('failed');
    expect(deps.store.getRun(run.id)!.status).toBe('failed');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test pipeline`
Expected: FAIL — `createPipeline` export 없음.

- [ ] **Step 3: 구현** — `apps/server/src/pipeline.ts` 전체 교체

```ts
import type { RunPhase } from '@ringq/shared';
import type { Store } from './store.js';
import type { FigmaClient } from './figma/client.js';
import type { CaseGenerator } from './cases/generator.js';
import { emitProgress, now } from './events.js';

interface PipelineDeps {
  store: Store;
  figma: FigmaClient;
  generator: CaseGenerator;
}

const RESUME_STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'running', message: 'Playwright로 사이트 실행 중...' },
  { phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...' },
  { phase: 'reporting', message: '리포트 작성 중...' },
];

export function createPipeline(deps: PipelineDeps, opts: { delayMs?: number } = {}) {
  const { store, figma, generator } = deps;
  const delayMs = opts.delayMs ?? 0;

  async function generate(runId: string): Promise<void> {
    const run = store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    store.updateRun(runId, { phase: 'generating-cases' });
    emitProgress({ runId, phase: 'generating-cases', message: 'Figma에서 테스트 케이스 생성 중...', at: now() });

    const extract = await figma.fetchExtract(run.figmaLinks[0]);
    const cases = await generator.generate(runId, extract);
    store.saveCases(runId, cases);

    store.updateRun(runId, { phase: 'awaiting-review' });
    emitProgress({
      runId,
      phase: 'awaiting-review',
      message: `케이스 ${cases.length}개 생성됨 — 검수 후 확정해 주세요`,
      at: now(),
    });
  }

  async function resume(runId: string): Promise<void> {
    for (const step of RESUME_STEPS) {
      store.updateRun(runId, { phase: step.phase });
      emitProgress({ runId, phase: step.phase, message: step.message, at: now() });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    store.updateRun(runId, { phase: 'done', status: 'done' });
    emitProgress({ runId, phase: 'done', message: 'QA 완료', at: now() });
  }

  return async (runId: string): Promise<void> => {
    try {
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      if (run.phase === 'queued' || run.phase === 'generating-cases') {
        await generate(runId);
      } else if (run.phase === 'cases-confirmed') {
        await resume(runId);
      }
    } catch (err) {
      store.updateRun(runId, { phase: 'failed', status: 'failed' });
      emitProgress({
        runId,
        phase: 'failed',
        message: err instanceof Error ? err.message : '알 수 없는 오류',
        at: now(),
      });
      throw err;
    }
  };
}
```

- [ ] **Step 4: `app.test.ts`의 setup을 새 파이프라인으로 갱신** (createSkeletonPipeline 제거로 깨지므로 같은 커밋에서 처리)

`app.test.ts` 상단의 import와 `setup()`을 다음으로 교체:

```ts
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createPipeline } from './pipeline.js';
import { createCaseGenerator } from './cases/generator.js';
import { createFakeLLM } from './llm/fake.js';
import type { FigmaClient, FigmaExtract } from './figma/client.js';

const fakeExtract: FigmaExtract = {
  fileKey: 'A',
  frames: [{ nodeId: '1:2', name: '로그인', texts: ['로그인'], elements: [], colors: [] }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => fakeExtract };

function setup() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  const queue = createQueue(createPipeline({ store, figma: fakeFigma, generator }, { delayMs: 0 }));
  const app = buildApp({ store, queue });
  return { store, queue, app };
}
```

(기존 4개 app 테스트는 그대로 통과해야 한다 — POST/GET/404 동작은 파이프라인 교체와 무관.)

- [ ] **Step 5: 테스트 통과 확인 (pipeline + app 둘 다)**

Run: `pnpm --filter @ringq/server test pipeline app`
Expected: pipeline 3 PASS + 기존 app 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/pipeline.test.ts apps/server/src/app.test.ts
git commit -m "$(printf '♻️ ringq: 파이프라인을 phase 인지형(generate→awaiting-review→resume)으로 재작성\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: API — 케이스 조회/수정/추가/확정 엔드포인트

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `Store`(Task 5), `JobQueue`, `@ringq/shared`(`TestCaseSchema`, `FlowStepSchema`).
- Produces (buildApp에 라우트 추가):
  - `GET /api/runs/:id/cases` → `store.listCases(id)` (run 없으면 404).
  - `PATCH /api/runs/:id/cases/:caseId` → body `{ title?, status?, uiExpectation?, steps? }` 검증 후 `store.updateCase`; 케이스 없으면 404.
  - `POST /api/runs/:id/cases` → 수동 flow 케이스 추가. body `{ title: string, steps: FlowStep[] }` 검증 → `store.addCase({ id: 'tc_<id>_manual_<n>', runId:id, type:'flow', source:'manual', status:'draft', title, steps })`. 201 + 생성된 케이스. (id 충돌 방지를 위해 기존 케이스 수로 n 생성.)
  - `POST /api/runs/:id/confirm` → run이 `awaiting-review`가 아니면 409 `{ error }`. 맞으면 `store.confirmCases(id)` → `store.updateRun(id, { phase: 'cases-confirmed' })` → `queue.enqueue(id)` → 200 + 갱신된 Run.
- buildApp의 deps는 변경 없음(`{ store, queue }`).

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/app.test.ts`의 `setup()` 재사용. 파일 끝에 append

```ts
import type { TestCase } from '@ringq/shared';

function seedAwaitingReview() {
  const { app, store, queue } = setup();
  const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
  store.updateRun(run.id, { phase: 'awaiting-review' });
  const c: TestCase = {
    id: 'tc_x_0', runId: run.id, type: 'ui', source: 'figma', status: 'draft',
    title: '로그인 UI', figmaNodeId: '1:2',
    uiExpectation: { texts: ['로그인'], elements: [], colors: [] },
  };
  store.saveCases(run.id, [c]);
  return { app, store, queue, run, c };
}

describe('GET /api/runs/:id/cases', () => {
  it('run의 케이스를 반환한다', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/cases` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('PATCH /api/runs/:id/cases/:caseId', () => {
  it('케이스 title/status를 갱신한다', async () => {
    const { app, run, c } = seedAwaitingReview();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/runs/${run.id}/cases/${c.id}`,
      payload: { title: '수정됨', status: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('수정됨');
  });

  it('없는 케이스는 404', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'PATCH', url: `/api/runs/${run.id}/cases/nope`, payload: { title: 'x' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/runs/:id/cases (수동 추가)', () => {
  it('flow 케이스를 추가한다', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cases`,
      payload: { title: '수동 플로우', steps: [{ action: 'click', target: '로그인 버튼' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('manual');
    expect(res.json().type).toBe('flow');
  });

  it('잘못된 step은 400', async () => {
    const { app, run } = seedAwaitingReview();
    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cases`,
      payload: { title: 'x', steps: [{ action: 'teleport', target: 'y' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/runs/:id/confirm', () => {
  it('awaiting-review면 확정하고 cases-confirmed로 큐에 넣는다', async () => {
    const { app, store, run } = seedAwaitingReview();
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().phase).toBe('cases-confirmed');
    expect(store.listCases(run.id)[0].status).toBe('confirmed');
  });

  it('awaiting-review가 아니면 409', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/confirm` });
    expect(res.statusCode).toBe(409);
  });
});
```

> 주의: `setup()`은 Task 6에서 이미 새 파이프라인(`createPipeline` + fakeFigma + fake LLM)으로 갱신되어 있다. 이 태스크는 새 케이스 라우트 테스트만 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: FAIL — 새 케이스/confirm 라우트가 없어 신규 테스트 실패(기존 setup·4개 테스트는 통과).

- [ ] **Step 3: 라우트 구현** — `apps/server/src/app.ts`

import에 추가:

```ts
import { TestCaseSchema, FlowStepSchema } from '@ringq/shared';
```

(기존 `import { ProjectInputSchema } from '@ringq/shared';`와 합쳐도 됨. `import type { ProgressEvent } from '@ringq/shared';`는 유지.)

`GET /api/runs/:id` 라우트 뒤, SSE 라우트 앞에 추가:

```ts
  app.get<{ Params: { id: string } }>('/api/runs/:id/cases', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listCases(req.params.id);
  });

  const CasePatchSchema = TestCaseSchema.pick({
    title: true,
    status: true,
    uiExpectation: true,
    steps: true,
  }).partial();

  app.patch<{ Params: { id: string; caseId: string } }>(
    '/api/runs/:id/cases/:caseId',
    async (req, reply) => {
      const parsed = CasePatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
      try {
        return store.updateCase(req.params.caseId, parsed.data);
      } catch {
        return reply.code(404).send({ error: 'case not found' });
      }
    },
  );

  const ManualCaseSchema = z.object({
    title: z.string().min(1),
    steps: z.array(FlowStepSchema).min(1),
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/cases', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    const parsed = ManualCaseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const n = store.listCases(req.params.id).length;
    const created = store.addCase({
      id: `tc_${req.params.id}_manual_${n}`,
      runId: req.params.id,
      type: 'flow',
      source: 'manual',
      status: 'draft',
      title: parsed.data.title,
      steps: parsed.data.steps,
    });
    return reply.code(201).send(created);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/confirm', async (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'not found' });
    if (run.phase !== 'awaiting-review') {
      return reply.code(409).send({ error: `run is not awaiting review (phase: ${run.phase})` });
    }
    store.confirmCases(req.params.id);
    const updated = store.updateRun(req.params.id, { phase: 'cases-confirmed' });
    queue.enqueue(req.params.id);
    return updated;
  });
```

`app.ts` 상단에 zod import가 없으면 추가: `import { z } from 'zod';`

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: PASS (기존 4 + 신규 7 = 11 tests).

- [ ] **Step 5: 전체 서버 스위트 확인**

Run: `pnpm --filter @ringq/server test`
Expected: 전부 PASS (store 11, figma 5, llm 1, generator 3, queue 2, pipeline 3, app 11).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "$(printf '✨ ringq: 케이스 조회/수정/추가/확정 API 엔드포인트 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: web — 케이스 검수 UI

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/CaseReview.tsx`
- Test: `apps/web/src/api.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 서버 API(Task 7), `@ringq/shared`(`TestCase`, `FlowStep`).
- Produces:
  - `api.ts`에 함수 추가:
    - `fetchCases(runId: string): Promise<TestCase[]>` → GET cases.
    - `patchCase(runId: string, caseId: string, patch: Partial<Pick<TestCase,'title'|'status'|'steps'|'uiExpectation'>>): Promise<TestCase>` → PATCH.
    - `addManualCase(runId: string, title: string, steps: FlowStep[]): Promise<TestCase>` → POST cases.
    - `confirmCases(runId: string): Promise<Run>` → POST confirm.
    - 각 함수 `!res.ok` 시 throw (기존 `createRun` 패턴 동일).
  - `CaseReview.tsx`: `{ runId: string; onConfirmed: () => void }` props. 마운트 시 `fetchCases` → 케이스 리스트 렌더(타입/타이틀/상태). 각 케이스에 "거부/복원" 토글(`patchCase` status), 수동 flow 추가 폼(title + 단일 step target → `addManualCase`), "확정하고 계속" 버튼(`confirmCases` → `onConfirmed`).
  - `App.tsx`: SSE progress에서 `phase==='awaiting-review'`를 받으면 `<CaseReview>`를 렌더. 확정(`onConfirmed`) 후에는 다시 진행 리스트만 보이며 SSE로 done까지 표시. (awaiting-review 도달 시 EventSource는 닫지 않고 유지 — resume 후 done 이벤트를 계속 받기 위함.)

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/web/src/api.test.ts` 끝에 append

```ts
import { fetchCases, confirmCases } from './api.js';

describe('fetchCases', () => {
  it('GET /api/runs/:id/cases 결과를 반환한다', async () => {
    const cases = [{ id: 'tc_1', type: 'ui', title: '로그인 UI' }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => cases });
    vi.stubGlobal('fetch', fetchMock);
    const got = await fetchCases('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/cases');
    expect(got).toHaveLength(1);
  });
});

describe('confirmCases', () => {
  it('POST /api/runs/:id/confirm 후 Run을 반환한다', async () => {
    const run = { id: 'run_1', phase: 'cases-confirmed' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => run });
    vi.stubGlobal('fetch', fetchMock);
    const got = await confirmCases('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/confirm', expect.objectContaining({ method: 'POST' }));
    expect(got.phase).toBe('cases-confirmed');
  });

  it('서버 실패 시 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    await expect(confirmCases('run_1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/web test`
Expected: FAIL — `fetchCases`/`confirmCases` export 없음.

- [ ] **Step 3: api 클라이언트 확장** — `apps/web/src/api.ts` 끝에 추가

```ts
import type { Run, TestCase, FlowStep } from '@ringq/shared';

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(`${what} 실패: ${JSON.stringify(body.error ?? res.status)}`);
  }
  return (await res.json()) as T;
}

export async function fetchCases(runId: string): Promise<TestCase[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/cases`), 'fetchCases');
}

export async function patchCase(
  runId: string,
  caseId: string,
  patch: Partial<Pick<TestCase, 'title' | 'status' | 'steps' | 'uiExpectation'>>,
): Promise<TestCase> {
  return jsonOrThrow(
    await fetch(`/api/runs/${runId}/cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'patchCase',
  );
}

export async function addManualCase(runId: string, title: string, steps: FlowStep[]): Promise<TestCase> {
  return jsonOrThrow(
    await fetch(`/api/runs/${runId}/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, steps }),
    }),
    'addManualCase',
  );
}

export async function confirmCases(runId: string): Promise<Run> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/confirm`, { method: 'POST' }), 'confirmCases');
}
```

> 참고: 기존 `createRun`은 그대로 둔다. (중복 헬퍼지만 기존 테스트 호환 위해 유지; 후속 정리 대상.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/web test`
Expected: PASS (기존 2 + 신규 3 = 5 tests).

- [ ] **Step 5: CaseReview 컴포넌트 작성** — `apps/web/src/CaseReview.tsx`

```tsx
import { useEffect, useState } from 'react';
import type { TestCase } from '@ringq/shared';
import { fetchCases, patchCase, addManualCase, confirmCases } from './api.js';

export function CaseReview({ runId, onConfirmed }: { runId: string; onConfirmed: () => void }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCases(runId).then(setCases).catch((e) => setError(String(e)));
  }, [runId]);

  async function toggle(c: TestCase) {
    const next = c.status === 'rejected' ? 'draft' : 'rejected';
    const updated = await patchCase(runId, c.id, { status: next });
    setCases((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
  }

  async function addFlow() {
    if (!title || !target) return;
    const created = await addManualCase(runId, title, [{ action: 'click', target }]);
    setCases((prev) => [...prev, created]);
    setTitle('');
    setTarget('');
  }

  async function confirm() {
    try {
      await confirmCases(runId);
      onConfirmed();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>테스트 케이스 검수 ({cases.length})</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul>
        {cases.map((c) => (
          <li key={c.id} style={{ opacity: c.status === 'rejected' ? 0.45 : 1 }}>
            <strong>[{c.type}]</strong> {c.title}{' '}
            <span style={{ fontSize: 12, color: '#888' }}>({c.source})</span>{' '}
            <button onClick={() => toggle(c)}>{c.status === 'rejected' ? '복원' : '거부'}</button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input placeholder="수동 플로우 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="클릭 대상(요소/화면 이름)" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button onClick={addFlow} disabled={!title || !target}>플로우 추가</button>
      </div>
      <button style={{ marginTop: 16 }} onClick={confirm}>확정하고 계속 ▶</button>
    </section>
  );
}
```

- [ ] **Step 6: App.tsx에 awaiting-review 분기 연결** — `apps/web/src/App.tsx` 수정

`import` 섹션에 추가:

```tsx
import { CaseReview } from './CaseReview.js';
```

컴포넌트 상태에 추가(다른 useState 옆):

```tsx
  const [awaitingReview, setAwaitingReview] = useState(false);
```

progress 리스너에서 awaiting-review를 감지하도록 수정. 기존:

```tsx
      es.addEventListener('progress', (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.phase === 'done' || ev.phase === 'failed') es.close();
      });
```

를 다음으로 교체:

```tsx
      es.addEventListener('progress', (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.phase === 'awaiting-review') setAwaitingReview(true);
        if (ev.phase === 'done' || ev.phase === 'failed') es.close();
      });
```

`onRun` 시작부에서 재실행 시 검수 상태 초기화(이미 있는 `setEvents([])` 옆):

```tsx
    setAwaitingReview(false);
```

진행 표시 `section` 뒤(또는 안)에 검수 UI 렌더 추가. `{run && ( ... )}` 블록의 `</section>` 뒤에 추가:

```tsx
      {run && awaitingReview && (
        <CaseReview runId={run.id} onConfirmed={() => setAwaitingReview(false)} />
      )}
```

> EventSource는 awaiting-review에서 닫지 않으므로(`done`/`failed`에서만 close), 확정 후 resume의 done 이벤트가 같은 스트림으로 도착해 진행 리스트가 완성된다.

- [ ] **Step 7: 빌드 검증**

Run: `pnpm --filter @ringq/web build`
Expected: 타입 에러 없이 성공.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "$(printf '✨ ringq: web 케이스 검수 UI(거부/복원·수동 추가·확정) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: 서버 와이어링 + .env.example + README + e2e 검증

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createPipeline`, `createFigmaClient`, `createAnthropicLLM`, `createCaseGenerator`, `createStore`, `createQueue`, `buildApp`.
- Produces: 실제 Figma/Claude 의존성을 주입한 부팅. `FIGMA_TOKEN`/`ANTHROPIC_API_KEY` 미설정 시 명확한 에러로 종료.

- [ ] **Step 1: index.ts 와이어링** — `apps/server/src/index.ts` 전체 교체

```ts
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createPipeline } from './pipeline.js';
import { createFigmaClient } from './figma/client.js';
import { createAnthropicLLM } from './llm/anthropic.js';
import { createCaseGenerator } from './cases/generator.js';

const figmaToken = process.env.FIGMA_TOKEN;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!figmaToken) {
  console.error('[ringq] FIGMA_TOKEN 환경변수가 필요합니다 (.env 참고)');
  process.exit(1);
}
if (!anthropicKey) {
  console.error('[ringq] ANTHROPIC_API_KEY 환경변수가 필요합니다 (.env 참고)');
  process.exit(1);
}

mkdirSync('data', { recursive: true });
const store = createStore('data/ringq.db');
const figma = createFigmaClient({ token: figmaToken });
const llm = createAnthropicLLM({ apiKey: anthropicKey });
const generator = createCaseGenerator(llm);
const queue = createQueue(createPipeline({ store, figma, generator }, { delayMs: 300 }));
const app = buildApp({ store, queue });

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[ringq] server listening on http://localhost:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: `.env.example` 확인/보강**

기존에 `ANTHROPIC_API_KEY`, `FIGMA_TOKEN`, `PORT`가 이미 있으면 변경 불필요. 없으면 추가. 최종 내용은 다음을 포함해야 한다:

```
ANTHROPIC_API_KEY=
FIGMA_TOKEN=
SITE_USERNAME=
SITE_PASSWORD=
PORT=4000
```

- [ ] **Step 3: README 업데이트** — `apps/.../README.md`의 "현재 상태" 문단 교체

기존 Plan 1 상태 문구를 다음으로 교체:

```markdown
> **현재 상태(Plan 2):** Phase 1(Figma 분석 → 케이스 자동생성 → 검수/확정)이 동작합니다. `.env`에 `FIGMA_TOKEN`과 `ANTHROPIC_API_KEY`가 필요합니다. 실행 → 케이스가 `awaiting-review`에서 생성되면 대시보드에서 검수·수정·추가 후 "확정하고 계속"을 누르면 나머지 Phase(running→comparing→reporting, 아직 스텁)가 진행됩니다. 실제 Playwright 실행/비교는 Plan 3~ 에서 구현됩니다.
```

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `pnpm -r test`
Expected: shared 8 + server(store 11 / figma 5 / llm 1 / generator 3 / queue 2 / pipeline 3 / app 11 = 36) + web 5 = 전부 PASS.

- [ ] **Step 5: 타입체크 (server/web)**

Run: `pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json && pnpm --filter @ringq/web build`
Expected: 타입 에러 없음.

- [ ] **Step 6: e2e 검증 (fake 경로 — 실제 키 불필요)**

실제 Figma/Claude 키 없이 검증하기 위해, 임시 검증 스크립트로 `createPipeline`을 fake figma+llm으로 구동해 awaiting-review→confirm→done 전체 경로를 확인한다(또는 app.inject로). 구체적으로: app.test.ts의 confirm 테스트가 이미 이 경로(awaiting-review→confirm→cases-confirmed enqueue)를 커버하고, pipeline.test.ts가 resume→done을 커버하므로 **신규 e2e 스크립트는 생략**하고 다음을 근거로 기록한다:
- `pnpm --filter @ringq/server test app pipeline` 출력(awaiting-review 정지 + confirm 409 가드 + resume done)을 리포트에 첨부.

Run: `pnpm --filter @ringq/server test app pipeline`
Expected: 관련 테스트 전부 PASS.

> 실제 라이브 e2e(진짜 Figma 파일 + Claude 키로 브라우저에서 케이스 생성 확인)는 키가 필요하므로 사용자 수동 검증 항목으로 남긴다. README에 실행법이 있다.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/index.ts .env.example README.md
git commit -m "$(printf '✨ ringq: Figma/Claude 의존성 와이어링 + .env/README 업데이트(Plan 2)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review 결과

**Spec coverage:**
- figma-client(REST 노드/이미지 + 구조 추출) → Task 2 ✅
- case-generator(Claude 자동생성, 하이브리드) → Task 3(LLM) + Task 4(가드) ✅
- 케이스 검수/수정/확정 UI(하이브리드의 사람 검수) → Task 7(API) + Task 8(web) ✅
- 환각 방지(프로토타입 연결 기반 + 미매칭 flow 폐기) → Task 4 ✅
- 수동 플로우 추가(결정 C) → Task 7 POST cases + Task 8 폼 ✅
- pause/resume 아키텍처(awaiting-review) → Task 1(phase) + Task 6(pipeline) ✅
- TestCase 영속화 → Task 5 ✅
- 외부 호출 주입/mock(테스트 네트워크 차단) → figma fetchImpl, CaseLLM fake, app.inject ✅
- 시크릿 가드(키 없으면 종료, .env만) → Task 9 ✅
- **Plan 2 범위 밖(의도된 스텁 유지)**: 실제 Playwright runner / comparator / report / code-suggester → Plan 3~5.

**Placeholder scan:** 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency:** `FigmaExtract`/`FigmaClient`(Task 2) → llm/generator/pipeline/app.test에서 동일 import. `CaseLLM`/`LlmCaseDraft`(Task 3) → generator/fake에서 일치. `TestCase`/`FlowStep`/`TestCaseSchema`(Task 1, shared) → store/generator/api/web 전부 동일 정의 import. `createPipeline(deps,{delayMs})` 시그니처가 index/app.test/pipeline.test에서 일치. store 신규 메서드명(saveCases/listCases/updateCase/addCase/confirmCases)이 pipeline/api에서 동일 사용.

**주의 사항(실행 시 리뷰 포인트):**
- Task 6에서 `createSkeletonPipeline`이 제거되므로, 이를 import하던 `app.test.ts` setup을 Task 7 Step 3에서 반드시 갱신(같은 커밋 흐름에서 처리). Task 6 단독 커밋 시점엔 app.test가 깨질 수 있으니 Task 6 구현 시 app.test의 import도 함께 새 파이프라인으로 옮기거나, Task 6→7을 연속 실행한다.
