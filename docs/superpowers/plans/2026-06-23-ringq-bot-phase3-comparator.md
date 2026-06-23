# RingQ-Bot Plan 4 · Phase 3 (comparator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `comparing` 스텁을 실제 하이브리드 비교로 교체한다 — 캡처한 화면(텍스트·요소·스크린샷)을 Figma 정답지와 비교해 심각도가 매겨진 결함(Finding) 목록을 만든다. 구조 diff(결정론: 기대 텍스트/요소 누락, 플로우 실패, 캡처 에러)와 비전 LLM(Claude: 레이아웃/시각/색)을 병합한다. 이 finding이 Plan 5(리포트)의 입력이 된다.

**Architecture:** comparator는 두 비교를 병합한다. (1) **structural**: 순수 함수 — `TestCase.uiExpectation` vs `RunCapture`(텍스트/요소) 결정론 비교. (2) **vision**: `VisionLLM` 포트 뒤 — 비교 시점에 figma-client로 프레임 이미지를 재조회(결정 A)해 실제 스크린샷과 함께 Claude 비전에 넘기고 finding을 받음. 외부 의존(Figma·Claude)은 주입, 테스트는 fake로 네트워크 없이 검증. `comparing` 단계에서 comparator가 store의 confirmed 케이스 + 캡처를 읽어 finding을 만들고 저장한다. `reporting`은 Plan 5까지 스텁.

**Tech Stack:** 기존 + Claude 비전(`@anthropic-ai/sdk` image content blocks). figma-client 재사용.

## Global Constraints

- 언어: TypeScript, ESM, Node 22. 테스트: vitest, `src/**/*.test.ts`.
- 모든 도메인 타입은 `@ringq/shared`에서만 정의 후 import (DRY).
- 외부 의존(Figma REST, Anthropic 비전)은 인터페이스 뒤로 주입. **테스트는 절대 실제 네트워크/LLM을 호출하지 않는다** — fake 사용. 실제 Anthropic 비전 구현은 타입 컴파일만 검증.
- severity는 `'critical' | 'major' | 'minor'` 3단계. 구조 비교는 결정론 규칙으로 severity 부여, 비전은 LLM이 severity 반환.
- 케이스 단위 격리: 한 케이스 비교(특히 비전 LLM 호출)가 throw해도 그 케이스를 건너뛰고 계속(부분 결과 보존). 단, figma 재조회 자체가 실패하면 비전 비교는 전체 스킵하고 구조 비교만 진행(비전은 베스트에포트).
- 시크릿(`.env`)·`data/`·스크린샷·DB 커밋 금지.
- 커밋 메시지 형식: `✨`/`🔨`/`♻️`/`🧪`/`📑` `ringq: <내용>` + Co-Authored-By:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 모든 pnpm 명령은 레포 루트에서 실행.
- Anthropic 모델 기본값: `claude-sonnet-4-6` (LLM 클라이언트와 동일).

---

### Task 1: `@ringq/shared` — Finding 타입

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts` (append)

**Interfaces:**
- Produces:
  - `SeveritySchema` = `z.enum(['critical', 'major', 'minor'])` → type `Severity`.
  - `FindingSourceSchema` = `z.enum(['structural', 'vision'])` → type `FindingSource`.
  - `FindingSchema` = `z.object({ id: z.string(), runId: z.string(), caseId: z.string(), category: z.string(), severity: SeveritySchema, message: z.string(), source: FindingSourceSchema })` → type `Finding`.
  - (category는 자유 문자열 — 구조: `missing-text`/`missing-element`/`flow-failed`/`capture-error`, 비전: `layout`/`visual`/`color` 등.)

- [ ] **Step 1: 실패하는 테스트 추가** — `packages/shared/src/index.test.ts` 끝에 append

```ts
import { FindingSchema, SeveritySchema } from './index.js';

describe('FindingSchema', () => {
  it('구조 finding을 검증한다', () => {
    const f = FindingSchema.parse({
      id: 'fd_1', runId: 'run_1', caseId: 'tc_1',
      category: 'missing-text', severity: 'major', message: '"로그인" 텍스트 없음', source: 'structural',
    });
    expect(f.severity).toBe('major');
    expect(f.source).toBe('structural');
  });

  it('잘못된 severity를 거부한다', () => {
    expect(() => SeveritySchema.parse('blocker')).toThrow();
  });

  it('잘못된 source를 거부한다', () => {
    expect(() =>
      FindingSchema.parse({ id: 'x', runId: 'r', caseId: 'c', category: 'x', severity: 'minor', message: 'm', source: 'guess' }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: FAIL — `FindingSchema` 없음.

- [ ] **Step 3: 구현** — `packages/shared/src/index.ts` 끝에 추가

```ts
export const SeveritySchema = z.enum(['critical', 'major', 'minor']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSourceSchema = z.enum(['structural', 'vision']);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  caseId: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  source: FindingSourceSchema,
});
export type Finding = z.infer<typeof FindingSchema>;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: PASS (기존 11 + 신규 3 = 14).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "$(printf '✨ ringq: shared에 Finding/Severity 타입 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: structural 비교 (순수 함수)

**Files:**
- Create: `apps/server/src/compare/structural.ts`
- Test: `apps/server/src/compare/structural.test.ts`

**Interfaces:**
- Consumes: `@ringq/shared`의 `TestCase`, `RunCapture`, `Severity`.
- Produces:
  - `structuralCompare(tc: TestCase, cap: RunCapture): Omit<Finding, 'id' | 'runId'>[]` — id/runId는 오케스트레이터(Task 4)가 부여하므로 여기선 `{ caseId, category, severity, message, source: 'structural' }` 형태로 반환.
  - 규칙:
    1. `cap.error`가 있으면 `[{ category: 'capture-error', severity: 'critical', message: cap.error }]` 하나만 반환(다른 비교 스킵).
    2. `tc.type === 'ui'`이고 `tc.uiExpectation`이 있으면: 각 기대 텍스트가 `cap.texts` 중 어디에도 부분 문자열(대소문자 무시)로 없으면 `missing-text`(major). 각 기대 요소가 `cap.elements` 중 없으면 `missing-element`(major).
    3. `tc.type === 'flow'`이고 `cap.flowOk === false`이면 `flow-failed`(major, message: `플로우 일부 단계 실패`).
    4. 문제 없으면 빈 배열.
  - (색 비교는 캡처에 색 데이터가 없으므로 구조 비교 대상 아님 — 비전이 담당.)

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/compare/structural.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { structuralCompare } from './structural.js';
import type { TestCase, RunCapture } from '@ringq/shared';

const uiCase: TestCase = {
  id: 'tc_1', runId: 'r1', type: 'ui', source: 'figma', status: 'confirmed',
  title: '로그인 UI', figmaNodeId: '1:2',
  uiExpectation: { texts: ['로그인', '비밀번호'], elements: ['로그인 버튼'], colors: [] },
};

function cap(partial: Partial<RunCapture>): RunCapture {
  return { caseId: 'tc_1', runId: 'r1', type: 'ui', url: 'https://e.com', texts: [], elements: [], ...partial };
}

describe('structuralCompare', () => {
  it('기대 텍스트/요소가 모두 있으면 finding 없음', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인 화면', '비밀번호 입력'], elements: ['로그인 버튼'] }));
    expect(f).toHaveLength(0);
  });

  it('누락된 텍스트는 missing-text(major)', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인 화면'], elements: ['로그인 버튼'] }));
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('missing-text');
    expect(f[0].severity).toBe('major');
    expect(f[0].source).toBe('structural');
    expect(f[0].message).toContain('비밀번호');
  });

  it('누락된 요소는 missing-element(major)', () => {
    const f = structuralCompare(uiCase, cap({ texts: ['로그인', '비밀번호'], elements: [] }));
    expect(f.some((x) => x.category === 'missing-element')).toBe(true);
  });

  it('cap.error가 있으면 capture-error(critical) 하나만', () => {
    const f = structuralCompare(uiCase, cap({ error: 'goto 실패' }));
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('capture-error');
    expect(f[0].severity).toBe('critical');
  });

  it('flow가 flowOk=false면 flow-failed(major)', () => {
    const flowCase: TestCase = { id: 'tc_2', runId: 'r1', type: 'flow', source: 'figma', status: 'confirmed', title: '플로우', steps: [{ action: 'click', target: 'x' }] };
    const f = structuralCompare(flowCase, { caseId: 'tc_2', runId: 'r1', type: 'flow', url: 'https://e.com', texts: [], elements: [], flowOk: false });
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe('flow-failed');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test structural`
Expected: FAIL — `./structural.js` 없음.

- [ ] **Step 3: 구현** — `apps/server/src/compare/structural.ts`

```ts
import type { Finding, RunCapture, TestCase } from '@ringq/shared';

export type PartialFinding = Omit<Finding, 'id' | 'runId'>;

function includesText(haystack: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return haystack.some((h) => h.toLowerCase().includes(n));
}

export function structuralCompare(tc: TestCase, cap: RunCapture): PartialFinding[] {
  if (cap.error) {
    return [{ caseId: tc.id, category: 'capture-error', severity: 'critical', message: `캡처 실패: ${cap.error}`, source: 'structural' }];
  }

  const findings: PartialFinding[] = [];

  if (tc.type === 'ui' && tc.uiExpectation) {
    for (const text of tc.uiExpectation.texts) {
      if (!includesText(cap.texts, text)) {
        findings.push({ caseId: tc.id, category: 'missing-text', severity: 'major', message: `기대 텍스트 "${text}"가 화면에 없음`, source: 'structural' });
      }
    }
    for (const el of tc.uiExpectation.elements) {
      if (!includesText(cap.elements, el)) {
        findings.push({ caseId: tc.id, category: 'missing-element', severity: 'major', message: `기대 요소 "${el}"가 화면에 없음`, source: 'structural' });
      }
    }
  }

  if (tc.type === 'flow' && cap.flowOk === false) {
    findings.push({ caseId: tc.id, category: 'flow-failed', severity: 'major', message: '플로우 일부 단계 실패', source: 'structural' });
  }

  return findings;
}
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test structural && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 5 tests PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/compare/structural.ts apps/server/src/compare/structural.test.ts
git commit -m "$(printf '✨ ringq: 구조 비교(텍스트/요소 누락·플로우 실패·캡처 에러) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: vision LLM 포트 — 비전 비교 클라이언트 + fake

**Files:**
- Create: `apps/server/src/compare/vision-types.ts`
- Create: `apps/server/src/compare/vision-fake.ts`
- Create: `apps/server/src/compare/vision-anthropic.ts`
- Test: `apps/server/src/compare/vision-fake.test.ts`

**Interfaces:**
- Consumes: `@ringq/shared`의 `Severity`, `UiExpectation`.
- Produces:
  - `vision-types.ts`:
    - `VisionFinding = { category: string; severity: Severity; message: string }`
    - `VisionInput = { title: string; figmaImageUrl: string; screenshotPath: string; expectation?: UiExpectation }`
    - `VisionLLM = { compare(input: VisionInput): Promise<VisionFinding[]> }`
  - `vision-fake.ts`: `createFakeVision(findings: VisionFinding[]): VisionLLM` — 주어진 findings 반환.
  - `vision-anthropic.ts`: `createAnthropicVision(opts: { apiKey: string; model?: string }): VisionLLM` — figma 이미지 URL을 fetch해 base64로, 스크린샷 파일을 base64로 읽어 두 이미지를 Claude 비전에 tool-use로 전달, `findings` 반환. 단위 테스트 없음(타입 컴파일만).

- [ ] **Step 1: 타입 작성** — `apps/server/src/compare/vision-types.ts`

```ts
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
```

- [ ] **Step 2: fake 작성** — `apps/server/src/compare/vision-fake.ts`

```ts
import type { VisionFinding, VisionLLM } from './vision-types.js';

export function createFakeVision(findings: VisionFinding[]): VisionLLM {
  return {
    async compare() {
      return findings;
    },
  };
}
```

- [ ] **Step 3: 실패하는 테스트 작성** — `apps/server/src/compare/vision-fake.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createFakeVision } from './vision-fake.js';

describe('fake vision', () => {
  it('주어진 findings를 반환한다', async () => {
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: '버튼 위치 다름' }]);
    const out = await vision.compare({ title: 't', figmaImageUrl: 'https://img', screenshotPath: 'x.png' });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('layout');
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test vision`
Expected: FAIL — `./vision-fake.js` 없음.

- [ ] **Step 5: Anthropic 비전 구현** — `apps/server/src/compare/vision-anthropic.ts`

```ts
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
```

- [ ] **Step 6: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test vision && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: fake 1 test PASS, tsc 0 errors.

> 참고: `@anthropic-ai/sdk` ^0.32의 이미지/툴 API와 다르면 최소 수정으로 타입 통과시키되 VisionLLM 동작은 동일하게 유지하고 리포트에 기록.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/compare/vision-types.ts apps/server/src/compare/vision-fake.ts apps/server/src/compare/vision-anthropic.ts apps/server/src/compare/vision-fake.test.ts
git commit -m "$(printf '✨ ringq: 비전 비교 LLM 포트(Anthropic 이미지 + fake) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: comparator 오케스트레이터

**Files:**
- Create: `apps/server/src/compare/comparator.ts`
- Test: `apps/server/src/compare/comparator.test.ts`

**Interfaces:**
- Consumes: `Store`(getRun/listCases/listCaptures), `FigmaClient`(Task: figma/client), `VisionLLM`(Task 3), `structuralCompare`(Task 2), `@ringq/shared`(`Finding`).
- Produces:
  - `createComparator(deps: { store: Store; figma: FigmaClient; vision: VisionLLM }): Comparator`
  - `Comparator.compare(runId: string): Promise<Finding[]>`
  - 동작:
    1. `store.getRun(runId)` 없으면 throw. confirmed 케이스 = `store.listCases(runId).filter(status==='confirmed')`. 캡처 = `store.listCaptures(runId)`(caseId→capture 맵).
    2. **structural**: 각 confirmed 케이스에 대해 해당 캡처가 있으면 `structuralCompare(tc, cap)` → findings에 추가.
    3. **vision(베스트에포트)**: figma 이미지가 필요. `figma.fetchExtract(run.figmaLinks[0])`를 try/catch로 1회 호출(실패하면 비전 전체 스킵, 구조 결과만). 성공 시 nodeId→imageUrl 맵 구성. 각 `ui` 케이스에 대해 (capture.screenshotPath 존재 && 해당 figmaNodeId의 imageUrl 존재)이면 `vision.compare({ title, figmaImageUrl, screenshotPath, expectation })` 호출(케이스별 try/catch — 실패 시 그 케이스 비전만 스킵) → VisionFinding을 Finding으로 변환(source: 'vision').
    4. 모든 finding에 `id`(`fd_<runId>_<n>`), `runId` 부여.
    5. 반환.

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/compare/comparator.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createStore } from '../store.js';
import { createComparator } from './comparator.js';
import { createFakeVision } from './vision-fake.js';
import type { FigmaClient, FigmaExtract } from '../figma/client.js';
import type { TestCase, RunCapture } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://example.com' };
const extract: FigmaExtract = {
  fileKey: 'A',
  frames: [{ nodeId: '1:2', name: '로그인', texts: [], elements: [], colors: [], imageUrl: 'https://img/1-2.png' }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => extract };

function seed() {
  const store = createStore(':memory:');
  const run = store.createRun(input);
  const cases: TestCase[] = [
    { id: 'tc_ui', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: '로그인 UI', figmaNodeId: '1:2', uiExpectation: { texts: ['로그인'], elements: [], colors: [] } },
  ];
  store.saveCases(run.id, cases);
  const caps: RunCapture[] = [
    { caseId: 'tc_ui', runId: run.id, type: 'ui', url: 'https://e.com', texts: [], elements: [], screenshotPath: '/tmp/x.png' },
  ];
  store.saveCaptures(run.id, caps);
  return { store, runId: run.id };
}

describe('comparator', () => {
  it('구조 finding과 비전 finding을 병합하고 id를 부여한다', async () => {
    const { store, runId } = seed();
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: '여백 차이' }]);
    const comparator = createComparator({ store, figma: fakeFigma, vision });

    const findings = await comparator.compare(runId);

    // 구조: 기대 텍스트 '로그인'이 캡처 texts(빈 배열)에 없음 → missing-text
    expect(findings.some((f) => f.source === 'structural' && f.category === 'missing-text')).toBe(true);
    // 비전: fake가 준 layout finding
    expect(findings.some((f) => f.source === 'vision' && f.category === 'layout')).toBe(true);
    expect(findings.every((f) => f.id.startsWith('fd_'))).toBe(true);
    expect(findings.every((f) => f.runId === runId)).toBe(true);
  });

  it('figma 재조회 실패 시 비전은 스킵하고 구조 결과만 반환', async () => {
    const { store, runId } = seed();
    const failingFigma: FigmaClient = { fetchExtract: async () => { throw new Error('figma down'); } };
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: 'x' }]);
    const comparator = createComparator({ store, figma: failingFigma, vision });

    const findings = await comparator.compare(runId);
    expect(findings.some((f) => f.source === 'structural')).toBe(true);
    expect(findings.some((f) => f.source === 'vision')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test comparator`
Expected: FAIL — `./comparator.js` 없음.

- [ ] **Step 3: 구현** — `apps/server/src/compare/comparator.ts`

```ts
import { existsSync } from 'node:fs';
import type { Finding } from '@ringq/shared';
import type { Store } from '../store.js';
import type { FigmaClient } from '../figma/client.js';
import type { VisionLLM } from './vision-types.js';
import { structuralCompare } from './structural.js';

export interface Comparator {
  compare(runId: string): Promise<Finding[]>;
}

export function createComparator(deps: { store: Store; figma: FigmaClient; vision: VisionLLM }): Comparator {
  const { store, figma, vision } = deps;

  return {
    async compare(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      const cases = store.listCases(runId).filter((c) => c.status === 'confirmed');
      const capByCase = new Map(store.listCaptures(runId).map((c) => [c.caseId, c]));

      const findings: Finding[] = [];
      let idx = 0;
      const add = (caseId: string, category: string, severity: Finding['severity'], message: string, source: Finding['source']) => {
        findings.push({ id: `fd_${runId}_${idx++}`, runId, caseId, category, severity, message, source });
      };

      // structural (always)
      for (const tc of cases) {
        const cap = capByCase.get(tc.id);
        if (!cap) continue;
        for (const f of structuralCompare(tc, cap)) {
          add(f.caseId, f.category, f.severity, f.message, 'structural');
        }
      }

      // vision (best-effort): re-fetch figma for frame images
      let imageByNode = new Map<string, string>();
      try {
        const extract = await figma.fetchExtract(run.figmaLinks[0]);
        imageByNode = new Map(extract.frames.filter((f) => f.imageUrl).map((f) => [f.nodeId, f.imageUrl!]));
      } catch {
        imageByNode = new Map(); // figma 실패 → 비전 스킵
      }

      for (const tc of cases) {
        if (tc.type !== 'ui' || !tc.figmaNodeId) continue;
        const cap = capByCase.get(tc.id);
        const figmaImageUrl = imageByNode.get(tc.figmaNodeId);
        if (!cap?.screenshotPath || !existsSync(cap.screenshotPath) || !figmaImageUrl) continue;
        try {
          const vf = await vision.compare({
            title: tc.title,
            figmaImageUrl,
            screenshotPath: cap.screenshotPath,
            expectation: tc.uiExpectation,
          });
          for (const f of vf) add(tc.id, f.category, f.severity, f.message, 'vision');
        } catch {
          // 케이스별 비전 실패는 건너뜀(부분 결과 보존)
        }
      }

      return findings;
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test comparator && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 2 tests PASS, tsc 0 errors.

> 주의: 테스트의 screenshotPath `/tmp/x.png`는 `existsSync`에서 false일 수 있어 비전이 스킵될 수 있다. 첫 테스트가 비전 finding을 기대하므로, **테스트에서 실제 임시 파일을 만들어 screenshotPath로 쓰도록** 보완한다(구현 시 `mkdtemp`+`writeFileSync`로 더미 png 생성). 구현자는 테스트의 seed에서 임시 파일 경로를 생성해 캡처에 넣을 것.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/compare/comparator.ts apps/server/src/compare/comparator.test.ts
git commit -m "$(printf '✨ ringq: comparator(구조+비전 병합, figma 재조회 베스트에포트) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: `store` — findings 영속화

**Files:**
- Modify: `apps/server/src/store.ts`
- Test: `apps/server/src/store.test.ts` (append)

**Interfaces:**
- Produces (Store 인터페이스에 추가):
  - `saveFindings(runId: string, findings: Finding[]): void` — 해당 run의 기존 finding 삭제 후 저장(트랜잭션).
  - `listFindings(runId: string): Finding[]` — 삽입 순.
  - 새 테이블 `findings(seq, id UNIQUE, run_id, case_id, category, severity, message, source)`.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/store.test.ts` 끝에 append

```ts
import type { Finding } from '@ringq/shared';

const f1: Finding = { id: 'fd_1', runId: 'r1', caseId: 'tc_1', category: 'missing-text', severity: 'major', message: 'x', source: 'structural' };
const f2: Finding = { id: 'fd_2', runId: 'r1', caseId: 'tc_1', category: 'layout', severity: 'minor', message: 'y', source: 'vision' };

describe('store findings', () => {
  it('saveFindings/listFindings 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveFindings('r1', [f1, f2]);
    const got = store.listFindings('r1');
    expect(got).toHaveLength(2);
    expect(got[0].severity).toBe('major');
    expect(got[1].source).toBe('vision');
  });

  it('saveFindings는 기존을 교체한다', () => {
    const store = createStore(':memory:');
    store.saveFindings('r1', [f1, f2]);
    store.saveFindings('r1', [f1]);
    expect(store.listFindings('r1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test store`
Expected: FAIL — saveFindings 없음.

- [ ] **Step 3: 구현** — `apps/server/src/store.ts`

import에 `Finding` 추가:

```ts
import type { ProjectInput, Run, RunPhase, RunStatus, TestCase, RunCapture, Finding } from '@ringq/shared';
```

`Store` 인터페이스에 추가(`listCaptures` 뒤):

```ts
  saveFindings(runId: string, findings: Finding[]): void;
  listFindings(runId: string): Finding[];
```

captures 테이블 생성 뒤에 findings 테이블 추가:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      run_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL
    );
  `);
```

`rowToCapture` 옆에 변환 헬퍼:

```ts
interface FindingRow {
  id: string;
  run_id: string;
  case_id: string;
  category: string;
  severity: string;
  message: string;
  source: string;
}

function rowToFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    category: row.category,
    severity: row.severity as Finding['severity'],
    message: row.message,
    source: row.source as Finding['source'],
  };
}
```

`return { ... }`의 `listCaptures` 뒤에 메서드 추가:

```ts
    saveFindings(runId, findings) {
      const del = db.prepare(`DELETE FROM findings WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO findings (id, run_id, case_id, category, severity, message, source)
         VALUES (@id, @run_id, @case_id, @category, @severity, @message, @source)`,
      );
      const tx = db.transaction((rows: Finding[]) => {
        del.run(runId);
        for (const f of rows) {
          ins.run({
            id: f.id,
            run_id: runId,
            case_id: f.caseId,
            category: f.category,
            severity: f.severity,
            message: f.message,
            source: f.source,
          });
        }
      });
      tx(findings);
    },
    listFindings(runId) {
      const rows = db.prepare(`SELECT * FROM findings WHERE run_id = ? ORDER BY seq ASC`).all(runId) as FindingRow[];
      return rows.map(rowToFinding);
    },
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test store && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 기존 13 + 신규 2 = 15 PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/src/store.test.ts
git commit -m "$(printf '✨ ringq: store에 findings 영속화(save/list) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: 파이프라인 — 실제 comparing 단계 (comparator 주입)

**Files:**
- Modify: `apps/server/src/pipeline.ts`
- Modify: `apps/server/src/pipeline.test.ts`
- Modify: `apps/server/src/app.test.ts` (setup에 comparator 주입)
- Modify: `apps/server/src/index.ts` (comparator 와이어링)

**Interfaces:**
- Consumes: `Comparator`(Task 4), 기존 deps.
- Produces:
  - `createPipeline`의 deps에 `comparator: Comparator` 추가.
  - `resume`에서 `comparing` 단계를 실제로: phase=`comparing` emit → `const findings = await comparator.compare(runId)` → `store.saveFindings(runId, findings)` → emit(메시지에 finding 수). 그 뒤 `reporting`은 스텁 유지 → `done`.
  - `STUB_STEPS`에서 `comparing` 제거 → `reporting`만 남김.
  - 에러 처리(failed+rethrow) 유지.

- [ ] **Step 1: pipeline.test.ts 갱신**

import 추가:

```ts
import { createComparator } from './compare/comparator.js';
import { createFakeVision } from './compare/vision-fake.js';
```

`makeDeps()`에 comparator 추가(runner 옆):

```ts
  const comparator = createComparator({ store, figma: fakeFigma, vision: createFakeVision([]) });
  return { store, generator, figma: fakeFigma, runner, comparator };
```

resume 테스트에 finding 저장 검증 추가(케이스가 캡처/비교되도록 — 기대 텍스트 누락으로 구조 finding 발생):

```ts
describe('pipeline resume 단계', () => {
  it('cases-confirmed면 캡처+비교 후 done, finding 저장', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    deps.store.saveCases(run.id, [
      { id: 'tc_1', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: 'UI', figmaNodeId: '1:2', uiExpectation: { texts: ['없는텍스트'], elements: [], colors: [] } },
    ]);
    deps.store.updateRun(run.id, { phase: 'cases-confirmed' });

    await createPipeline(deps, { delayMs: 0 })(run.id);

    expect(deps.store.getRun(run.id)!.phase).toBe('done');
    expect(deps.store.listCaptures(run.id).length).toBe(1);
    expect(deps.store.listFindings(run.id).length).toBeGreaterThan(0); // 기대 텍스트 누락 → 구조 finding
  });
});
```

(fake runner의 screen은 `{ texts: ['홈'], elements: [] }` → 기대 텍스트 '없는텍스트' 누락 → missing-text finding 발생.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test pipeline`
Expected: FAIL — createPipeline가 comparator를 모름 / listFindings 0.

- [ ] **Step 3: pipeline.ts 구현**

import 추가:

```ts
import type { Comparator } from './compare/comparator.js';
```

`PipelineDeps`에 `comparator: Comparator;` 추가. `const { store, figma, generator, runner, comparator } = deps;`로.

`STUB_STEPS`에서 comparing 제거:

```ts
const STUB_STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'reporting', message: '리포트 작성 중...' },
];
```

`resume`에서 running 블록(runner.run + saveCaptures) 뒤, STUB_STEPS 루프 앞에 comparing 추가:

```ts
    // comparing (실제 하이브리드 비교)
    store.updateRun(runId, { phase: 'comparing' });
    emitProgress({ runId, phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...', at: now() });
    const findings = await comparator.compare(runId);
    store.saveFindings(runId, findings);
    emitProgress({ runId, phase: 'comparing', message: `결함 ${findings.length}건 발견`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
```

- [ ] **Step 4: app.test.ts setup에 comparator 주입**

import 추가:

```ts
import { createComparator } from './compare/comparator.js';
import { createFakeVision } from './compare/vision-fake.js';
```

`setup()`에 comparator 추가:

```ts
  const comparator = createComparator({ store, figma: fakeFigma, vision: createFakeVision([]) });
  const queue = createQueue(createPipeline({ store, figma: fakeFigma, generator, runner, comparator }, { delayMs: 0 }));
```

- [ ] **Step 5: index.ts 와이어링**

import 추가:

```ts
import { createComparator } from './compare/comparator.js';
import { createAnthropicVision } from './compare/vision-anthropic.js';
```

runner 생성 뒤, queue 앞에:

```ts
const vision = createAnthropicVision({ apiKey: anthropicKey });
const comparator = createComparator({ store, figma, vision });
```

(`anthropicKey`는 이미 index.ts에서 가드로 확보된 변수. 없으면 그 변수명에 맞춰 `process.env.ANTHROPIC_API_KEY!` 사용.)

queue 생성을 `createQueue(createPipeline({ store, figma, generator, runner, comparator }, { delayMs: 300 }))`로.

- [ ] **Step 6: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test pipeline app && pnpm --filter @ringq/server test && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: pipeline 3 + app 15 PASS, 전체 서버 스위트 PASS, tsc 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/pipeline.test.ts apps/server/src/app.test.ts apps/server/src/index.ts
git commit -m "$(printf '♻️ ringq: 파이프라인 comparing 단계를 실제 comparator로 교체\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: API — finding 조회

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts` (append)

**Interfaces:**
- Produces:
  - `GET /api/runs/:id/findings` → `store.listFindings(id)` (run 없으면 404).

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/app.test.ts` 끝에 append

```ts
import type { Finding } from '@ringq/shared';

describe('GET /api/runs/:id/findings', () => {
  it('run의 finding을 반환한다', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    const fs: Finding[] = [{ id: 'fd_1', runId: run.id, caseId: 'tc_1', category: 'missing-text', severity: 'major', message: 'x', source: 'structural' }];
    store.saveFindings(run.id, fs);
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/findings` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('없는 run이면 404', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/runs/nope/findings' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: FAIL — findings 라우트 없음.

- [ ] **Step 3: 구현** — `apps/server/src/app.ts`

captures 라우트 뒤(SSE 앞)에 추가:

```ts
  app.get<{ Params: { id: string } }>('/api/runs/:id/findings', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listFindings(req.params.id);
  });
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test app && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 기존 15 + 신규 2 = 17 PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "$(printf '✨ ringq: finding 조회 API 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: web — finding(결함) 뷰

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/Findings.tsx`
- Modify: `apps/web/src/Captures.tsx` (또는 App.tsx에 Findings 추가)
- Test: `apps/web/src/api.test.ts` (append)

**Interfaces:**
- Produces:
  - `api.ts`에 `fetchFindings(runId: string): Promise<Finding[]>` (GET findings, `!res.ok` throw).
  - `Findings.tsx`: `{ runId: string }`. 마운트 시 `fetchFindings` → severity 순(critical→major→minor)으로 정렬해 렌더(케이스·category·source·message). 결함 0건이면 "결함 없음 ✅". 새로고침 버튼.
  - `App.tsx`: phase가 `done`이면 `<Findings runId={run.id} />`를 `<Captures>` 위/아래에 렌더.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/web/src/api.test.ts` 끝에 append

```ts
import { fetchFindings } from './api.js';

describe('fetchFindings', () => {
  it('GET /api/runs/:id/findings 결과를 반환한다', async () => {
    const fs = [{ id: 'fd_1', caseId: 'tc_1', category: 'missing-text', severity: 'major', message: 'x', source: 'structural' }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fs });
    vi.stubGlobal('fetch', fetchMock);
    const got = await fetchFindings('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/findings');
    expect(got).toHaveLength(1);
  });

  it('서버 실패 시 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    await expect(fetchFindings('run_1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/web test`
Expected: FAIL — `fetchFindings` 없음.

- [ ] **Step 3: api.ts에 추가** — `apps/web/src/api.ts` 끝에

```ts
import type { Finding } from '@ringq/shared';

export async function fetchFindings(runId: string): Promise<Finding[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/findings`), 'fetchFindings');
}
```

(`Finding`을 기존 `@ringq/shared` import에 합칠 것 — 중복 import 라인 금지.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/web test`
Expected: 기존 7 + 신규 2 = 9 PASS.

- [ ] **Step 5: Findings 컴포넌트 작성** — `apps/web/src/Findings.tsx`

```tsx
import { useEffect, useState } from 'react';
import type { Finding } from '@ringq/shared';
import { fetchFindings } from './api.js';

const ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 };
const COLOR: Record<string, string> = { critical: '#b00020', major: '#d97706', minor: '#6b7280' };

export function Findings({ runId }: { runId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetchFindings(runId).then(setFindings).catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  const sorted = [...findings].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));

  return (
    <section style={{ marginTop: 24 }}>
      <h2>결함 ({findings.length}) <button onClick={load}>새로고침</button></h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {findings.length === 0 && !error && <p>결함 없음 ✅</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {sorted.map((f) => (
          <li key={f.id} style={{ borderLeft: `4px solid ${COLOR[f.severity] ?? '#999'}`, padding: '6px 12px', marginBottom: 6 }}>
            <strong style={{ color: COLOR[f.severity] ?? '#999' }}>{f.severity.toUpperCase()}</strong>{' '}
            <span style={{ fontSize: 12, color: '#888' }}>[{f.source}/{f.category}]</span>{' '}
            <span>· {f.caseId}</span>
            <div>{f.message}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: App.tsx에 Findings 연결** — `apps/web/src/App.tsx`

import 추가:

```tsx
import { Findings } from './Findings.js';
```

`{run && done && <Captures runId={run.id} />}` 위에 추가:

```tsx
      {run && done && <Findings runId={run.id} />}
```

- [ ] **Step 7: 빌드 검증**

Run: `pnpm --filter @ringq/web test && pnpm --filter @ringq/web build`
Expected: 9 tests PASS, 빌드 성공.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "$(printf '✨ ringq: web 결함(finding) 뷰(심각도 정렬) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 9: README + e2e 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 업데이트** — "현재 상태" 문단 교체

```markdown
> **현재 상태(Plan 4):** Phase 1(Figma→케이스→검수/확정) + Phase 2(Playwright 캡처) + Phase 3(하이브리드 비교)가 동작합니다. 확정 후 runner가 화면을 캡처하면 comparator가 **구조 diff(텍스트/요소 누락·플로우 실패)** 와 **비전 LLM(Claude로 레이아웃/색/시각 비교)** 를 병합해 심각도(critical/major/minor)가 매겨진 결함 목록을 만들고, 대시보드의 "결함"에서 확인합니다. 리포트(reporting)는 아직 스텁이며 Plan 5에서 구현됩니다.
```

- [ ] **Step 2: 전체 테스트 + 타입체크 + 빌드**

Run: `pnpm -r test && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json && pnpm --filter @ringq/web build`
Expected: 전부 PASS/clean. (shared 14, server: store 15/figma 5/llm 1/generator 4/queue 2/pipeline 3/app 17/browser 2/runner 4/structural 5/vision 1/comparator 2, web 9)

- [ ] **Step 3: e2e 검증 (fake 경로)**

awaiting-review→confirm→running→comparing(structural+fake vision)→done + finding 저장 경로는 pipeline.test(resume) + app.test(findings)가 커버. 근거로 출력 첨부:

Run: `pnpm --filter @ringq/server test pipeline app comparator structural`
Expected: 관련 테스트 전부 PASS.

> 실제 라이브 e2e(진짜 Claude 비전)는 키 필요 — 사용자 수동 검증.

- [ ] **Step 4: data/ 미커밋 확인**

Run: `git status --porcelain | grep -E '(data/|\.png|\.db)' || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(printf '📑 ringq: Plan 4(comparator) README + 실행 안내 업데이트\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review 결과

**Spec coverage:**
- 하이브리드 비교(구조 diff + 비전 LLM) → Task 2(structural) + Task 3(vision 포트) + Task 4(병합) ✅
- Figma 기준 이미지 비교 시점 재조회(결정 A) → Task 4 ✅
- 3단계 severity Finding(결정 A) → Task 1 ✅
- 비전 베스트에포트 + 케이스 단위 격리(figma 실패 → 구조만, 케이스 비전 실패 → 스킵) → Task 4 ✅
- finding 영속 → Task 5 ✅
- comparing 실연결 → Task 6 ✅
- 결과 노출(API+web 심각도 정렬) → Task 7 + Task 8 ✅
- 외부 의존 주입/테스트 네트워크 차단(fake figma·fake vision) → Task 3/4/6 ✅
- **Plan 4 범위 밖(의도된 스텁)**: report(reporting) + code-suggester → Plan 5.

**Placeholder scan:** 없음.

**Type consistency:** `Finding`/`Severity`/`FindingSource`(Task 1, shared) → structural/comparator/store/api/web 동일 import. `VisionLLM`/`VisionFinding`/`VisionInput`(Task 3) → comparator/vision-anthropic/fake 동일. `Comparator`(Task 4) → pipeline/index 동일. `PartialFinding`(Task 2) → comparator가 id/runId 부여. `createPipeline(deps{store,figma,generator,runner,comparator})` 시그니처가 pipeline/app.test/index 일치. store 신규(saveFindings/listFindings)가 comparator-pipeline/api에서 동일 사용.

**태스크 경계 주의:** Task 6이 `createPipeline` 시그니처에 comparator를 추가 → pipeline.test/app.test/index를 같은 커밋에서 갱신(Step 1·4·5). Plan 2 T6·Plan 3 T5와 동일 패턴.

**Task 4 테스트 보완(중요):** comparator.test의 첫 테스트가 비전 finding을 기대하므로, seed의 `screenshotPath`는 `existsSync`가 true가 되도록 **실제 임시 파일**(mkdtemp + writeFileSync 더미)로 만들어야 한다. 구현자는 이를 반영할 것(Task 4 Step 4 주석 참조).
