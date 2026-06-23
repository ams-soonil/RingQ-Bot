# RingQ-Bot Plan 5 · Phase 4 (리포트 + 코드 수정 가이드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `reporting` 스텁을 실제로 채운다 — 결함(Finding)을 종합해 심각도 집계 + 합격/불합격 판정(verdict)을 담은 **구조화 QA 리포트**를 만들고, 베스트에포트로 결함 기반 **경량 코드 수정 가이드(LLM)** 텍스트를 붙인다. 이것으로 전체 파이프라인(생성→캡처→비교→리포트)이 완성된다.

**Architecture:** report-builder는 순수 함수(결정론 집계·verdict). 수정 가이드는 `FixSuggester` 포트 뒤(주입, fake 테스트, 실제는 Claude — repo clone 없이 결함만으로 가이드 생성, 베스트에포트). `reporting` 단계에서 리포트를 만들고 가이드를 best-effort로 붙여 저장한다. 리포트는 run당 1건.

**Tech Stack:** 기존 + Claude(`@anthropic-ai/sdk`, 텍스트). repo 접근 없음(결정 B).

## Global Constraints

- TypeScript ESM, Node 22. vitest, `src/**/*.test.ts`. 타입은 `@ringq/shared`에서만.
- 외부 의존(Anthropic) 주입, fake 테스트, 실제 구현은 타입 컴파일만. 테스트는 네트워크/LLM 호출 금지.
- verdict 규칙(결정론): critical 또는 major가 1건이라도 있으면 `'fail'`, 아니면 `'pass'`.
- 수정 가이드는 베스트에포트: 실패해도 리포트는 저장(가이드만 비움).
- 시크릿/data/db/dist 커밋 금지. 커밋: `✨`/`🔨`/`♻️`/`🧪`/`📑` `ringq: <내용>` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- pnpm은 레포 루트에서. Anthropic 모델 기본값 `claude-sonnet-4-6`.

---

### Task 1: `@ringq/shared` — Report 타입

**Files:** Modify `packages/shared/src/index.ts`; Test `packages/shared/src/index.test.ts` (append).

**Produces:**
- `VerdictSchema` = `z.enum(['pass', 'fail'])` → `Verdict`.
- `ReportSchema` = `z.object({ runId: z.string(), total: z.number(), critical: z.number(), major: z.number(), minor: z.number(), verdict: VerdictSchema, generatedAt: z.string(), suggestion: z.string().optional() })` → `Report`.

- [ ] **Step 1: 실패 테스트 append**

```ts
import { ReportSchema } from './index.js';

describe('ReportSchema', () => {
  it('리포트를 검증한다', () => {
    const r = ReportSchema.parse({ runId: 'r1', total: 3, critical: 1, major: 1, minor: 1, verdict: 'fail', generatedAt: '2026-06-23T00:00:00Z' });
    expect(r.verdict).toBe('fail');
  });
  it('잘못된 verdict를 거부한다', () => {
    expect(() => ReportSchema.parse({ runId: 'r1', total: 0, critical: 0, major: 0, minor: 0, verdict: 'maybe', generatedAt: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @ringq/shared test` → FAIL.
- [ ] **Step 3: 구현** — index.ts 끝에 추가

```ts
export const VerdictSchema = z.enum(['pass', 'fail']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ReportSchema = z.object({
  runId: z.string(),
  total: z.number(),
  critical: z.number(),
  major: z.number(),
  minor: z.number(),
  verdict: VerdictSchema,
  generatedAt: z.string(),
  suggestion: z.string().optional(),
});
export type Report = z.infer<typeof ReportSchema>;
```

- [ ] **Step 4: GREEN** — `pnpm --filter @ringq/shared test` → PASS (14 + 2 = 16).
- [ ] **Step 5: Commit** `✨ ringq: shared에 Report/Verdict 타입 추가`

---

### Task 2: report-builder (순수 함수)

**Files:** Create `apps/server/src/report/builder.ts`; Test `apps/server/src/report/builder.test.ts`.

**Produces:** `buildReport(runId: string, findings: Finding[], generatedAt: string): Report` — severity별 카운트, total, verdict(critical+major>0 → fail). suggestion은 미설정(파이프라인이 베스트에포트로 붙임).

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, it, expect } from 'vitest';
import { buildReport } from './builder.js';
import type { Finding } from '@ringq/shared';

function f(severity: Finding['severity']): Finding {
  return { id: 'x', runId: 'r1', caseId: 'c', category: 'x', severity, message: 'm', source: 'structural' };
}

describe('buildReport', () => {
  it('심각도별 카운트와 total', () => {
    const r = buildReport('r1', [f('critical'), f('major'), f('minor'), f('minor')], 'now');
    expect(r.total).toBe(4);
    expect(r.critical).toBe(1);
    expect(r.major).toBe(1);
    expect(r.minor).toBe(2);
    expect(r.generatedAt).toBe('now');
  });
  it('critical/major 있으면 fail', () => {
    expect(buildReport('r1', [f('major')], 'now').verdict).toBe('fail');
    expect(buildReport('r1', [f('critical')], 'now').verdict).toBe('fail');
  });
  it('minor만이거나 결함 없으면 pass', () => {
    expect(buildReport('r1', [f('minor')], 'now').verdict).toBe('pass');
    expect(buildReport('r1', [], 'now').verdict).toBe('pass');
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @ringq/server test report` → FAIL.
- [ ] **Step 3: 구현** — `apps/server/src/report/builder.ts`

```ts
import type { Finding, Report } from '@ringq/shared';

export function buildReport(runId: string, findings: Finding[], generatedAt: string): Report {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const major = findings.filter((f) => f.severity === 'major').length;
  const minor = findings.filter((f) => f.severity === 'minor').length;
  return {
    runId,
    total: findings.length,
    critical,
    major,
    minor,
    verdict: critical + major > 0 ? 'fail' : 'pass',
    generatedAt,
  };
}
```

- [ ] **Step 4: GREEN + tsc** — `pnpm --filter @ringq/server test report && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `✨ ringq: report-builder(집계+verdict 순수 함수) 추가`

---

### Task 3: fix-suggester 포트 (경량 LLM 가이드)

**Files:** Create `apps/server/src/report/suggester-types.ts`, `suggester-fake.ts`, `suggester-anthropic.ts`; Test `suggester-fake.test.ts`.

**Produces:**
- `suggester-types.ts`: `FixSuggester = { suggest(findings: Finding[], cases: TestCase[]): Promise<string> }`.
- `suggester-fake.ts`: `createFakeSuggester(text: string): FixSuggester` → 항상 text 반환.
- `suggester-anthropic.ts`: `createAnthropicSuggester({ apiKey, model? }): FixSuggester` — 결함 목록 + 케이스 제목을 텍스트로 Claude에 주고 한국어 수정 가이드 반환(repo 접근 없음). 타입 컴파일만.

- [ ] **Step 1: types + fake**

```ts
// suggester-types.ts
import type { Finding, TestCase } from '@ringq/shared';
export interface FixSuggester {
  suggest(findings: Finding[], cases: TestCase[]): Promise<string>;
}
```
```ts
// suggester-fake.ts
import type { FixSuggester } from './suggester-types.js';
export function createFakeSuggester(text: string): FixSuggester {
  return { async suggest() { return text; } };
}
```

- [ ] **Step 2: 실패 테스트** — `suggester-fake.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createFakeSuggester } from './suggester-fake.js';

describe('fake suggester', () => {
  it('주어진 텍스트를 반환한다', async () => {
    const s = createFakeSuggester('이렇게 고치세요');
    expect(await s.suggest([], [])).toBe('이렇게 고치세요');
  });
});
```

- [ ] **Step 3: RED** — `pnpm --filter @ringq/server test suggester` → FAIL.
- [ ] **Step 4: anthropic 구현** — `suggester-anthropic.ts`

```ts
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
```

- [ ] **Step 5: GREEN + tsc** — `pnpm --filter @ringq/server test suggester && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`.
- [ ] **Step 6: Commit** `✨ ringq: 코드 수정 가이드 LLM 포트(Anthropic 텍스트 + fake) 추가`

---

### Task 4: store — report 영속화

**Files:** Modify `apps/server/src/store.ts`; Test `apps/server/src/store.test.ts` (append).

**Produces (Store 인터페이스):** `saveReport(report: Report): void` (run당 1건, 같은 runId면 교체), `getReport(runId: string): Report | undefined`. 테이블 `reports(run_id UNIQUE, total, critical, major, minor, verdict, generated_at, suggestion)`.

- [ ] **Step 1: 실패 테스트 append**

```ts
import type { Report } from '@ringq/shared';
const rep: Report = { runId: 'r1', total: 2, critical: 0, major: 1, minor: 1, verdict: 'fail', generatedAt: 'now', suggestion: '가이드' };

describe('store report', () => {
  it('saveReport/getReport 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveReport(rep);
    expect(store.getReport('r1')?.verdict).toBe('fail');
    expect(store.getReport('r1')?.suggestion).toBe('가이드');
  });
  it('saveReport는 같은 run을 교체한다', () => {
    const store = createStore(':memory:');
    store.saveReport(rep);
    store.saveReport({ ...rep, verdict: 'pass', suggestion: undefined });
    expect(store.getReport('r1')?.verdict).toBe('pass');
    expect(store.getReport('r1')?.suggestion).toBeUndefined();
  });
  it('없으면 undefined', () => {
    expect(createStore(':memory:').getReport('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @ringq/server test store` → FAIL.
- [ ] **Step 3: 구현** — store.ts: import에 `Report` 추가; 인터페이스에 `saveReport`/`getReport`; findings 테이블 뒤에:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      run_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL,
      critical INTEGER NOT NULL,
      major INTEGER NOT NULL,
      minor INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      suggestion TEXT
    );
  `);
```

`rowToFinding` 옆:

```ts
interface ReportRow {
  run_id: string; total: number; critical: number; major: number; minor: number;
  verdict: string; generated_at: string; suggestion: string | null;
}
function rowToReport(row: ReportRow): Report {
  return {
    runId: row.run_id, total: row.total, critical: row.critical, major: row.major, minor: row.minor,
    verdict: row.verdict as Report['verdict'], generatedAt: row.generated_at, suggestion: row.suggestion ?? undefined,
  };
}
```

메서드(`listFindings` 뒤):

```ts
    saveReport(report) {
      db.prepare(
        `INSERT INTO reports (run_id, total, critical, major, minor, verdict, generated_at, suggestion)
         VALUES (@run_id, @total, @critical, @major, @minor, @verdict, @generated_at, @suggestion)
         ON CONFLICT(run_id) DO UPDATE SET
           total=@total, critical=@critical, major=@major, minor=@minor,
           verdict=@verdict, generated_at=@generated_at, suggestion=@suggestion`,
      ).run({
        run_id: report.runId, total: report.total, critical: report.critical, major: report.major,
        minor: report.minor, verdict: report.verdict, generated_at: report.generatedAt,
        suggestion: report.suggestion ?? null,
      });
    },
    getReport(runId) {
      const row = db.prepare(`SELECT * FROM reports WHERE run_id = ?`).get(runId) as ReportRow | undefined;
      return row ? rowToReport(row) : undefined;
    },
```

- [ ] **Step 4: GREEN + tsc** — `pnpm --filter @ringq/server test store && tsc`.
- [ ] **Step 5: Commit** `✨ ringq: store에 report 영속화(save/get, upsert) 추가`

---

### Task 5: 파이프라인 — 실제 reporting 단계

**Files:** Modify `pipeline.ts`, `pipeline.test.ts`, `app.test.ts`(setup), `index.ts`.

**Produces:** `createPipeline` deps에 `suggester: FixSuggester` 추가. `reporting` 단계: phase=`reporting` emit → `const findings = store.listFindings(runId)` → `const report = buildReport(runId, findings, now())` → findings>0이면 try `report.suggestion = await suggester.suggest(findings, listCases confirmed)` catch 무시 → `store.saveReport(report)` → emit. 그 뒤 done. `STUB_STEPS` 제거(이제 reporting이 실제). 에러 처리 유지.

- [ ] **Step 1: pipeline.test.ts 갱신** — makeDeps에 `suggester: createFakeSuggester('가이드')` 추가; resume 테스트에 `expect(store.getReport(run.id)?.verdict).toBeDefined()` 추가.
- [ ] **Step 2: RED**.
- [ ] **Step 3: pipeline.ts** — import `buildReport`, `now`(이미 있음), `FixSuggester`, `createFakeSuggester`(테스트만). deps에 suggester. `STUB_STEPS` 루프를 제거하고 reporting 블록으로 교체:

```ts
    // reporting (실제: 리포트 + 베스트에포트 수정 가이드)
    store.updateRun(runId, { phase: 'reporting' });
    emitProgress({ runId, phase: 'reporting', message: '리포트 작성 중...', at: now() });
    const findings = store.listFindings(runId);
    const report = buildReport(runId, findings, now());
    if (findings.length > 0) {
      try {
        const cases = store.listCases(runId).filter((c) => c.status === 'confirmed');
        report.suggestion = await suggester.suggest(findings, cases);
      } catch {
        // 가이드 실패는 무시(리포트는 저장)
      }
    }
    store.saveReport(report);
    emitProgress({ runId, phase: 'reporting', message: `리포트 완료 — ${report.verdict.toUpperCase()}`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
```

- [ ] **Step 4: app.test.ts setup** — `suggester: createFakeSuggester('')` 주입; createPipeline에 전달. import 추가.
- [ ] **Step 5: index.ts** — `import { createAnthropicSuggester } from './report/suggester-anthropic.js';` + `const suggester = createAnthropicSuggester({ apiKey: anthropicKey });` + createPipeline에 suggester 전달.
- [ ] **Step 6: GREEN + tsc + full** — `pnpm --filter @ringq/server test pipeline app && pnpm --filter @ringq/server test && tsc`.
- [ ] **Step 7: Commit** `♻️ ringq: 파이프라인 reporting 단계를 실제 리포트+수정가이드로 교체`

---

### Task 6: API — report 조회

**Files:** Modify `app.ts`; Test `app.test.ts` (append).

**Produces:** `GET /api/runs/:id/report` → `store.getReport(id)`; run 없으면 404, 리포트 아직 없으면 404 `{ error: 'no report' }`.

- [ ] **Step 1: 실패 테스트 append** (200 반환 + run 없음 404 + 리포트 없음 404).
- [ ] **Step 2: RED**.
- [ ] **Step 3: 구현** — findings 라우트 뒤:

```ts
  app.get<{ Params: { id: string } }>('/api/runs/:id/report', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    const report = store.getReport(req.params.id);
    if (!report) return reply.code(404).send({ error: 'no report' });
    return report;
  });
```

- [ ] **Step 4: GREEN + tsc** (app 17 + 3 = 20).
- [ ] **Step 5: Commit** `✨ ringq: report 조회 API 추가`

---

### Task 7: web — 리포트 뷰

**Files:** Modify `api.ts`; Create `Report.tsx`; Modify `App.tsx`; Test `api.test.ts` (append).

**Produces:**
- `api.ts`: `fetchReport(runId): Promise<Report | null>` — 404면 null 반환(아직 리포트 없음), 그 외 `!res.ok` throw. (`jsonOrThrow`와 별개로 404를 null로 처리.)
- `Report.tsx`: `{ runId }`. fetchReport → verdict 배지(PASS 초록/FAIL 빨강) + 집계(critical/major/minor/total) + suggestion(있으면 마크다운 텍스트 그대로). 새로고침.
- `App.tsx`: done이면 `<Report>`를 `<Findings>` 위에 렌더.

- [ ] **Step 1: 실패 테스트 append** (fetchReport 200 반환, 404 → null).

```ts
import { fetchReport } from './api.js';
describe('fetchReport', () => {
  it('200이면 report 반환', async () => {
    const rep = { runId: 'run_1', total: 0, critical: 0, major: 0, minor: 0, verdict: 'pass', generatedAt: 'now' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rep }));
    expect((await fetchReport('run_1'))?.verdict).toBe('pass');
  });
  it('404면 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'no report' }) }));
    expect(await fetchReport('run_1')).toBeNull();
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @ringq/web test` → FAIL.
- [ ] **Step 3: api.ts** — `Report`를 기존 import에 합치고:

```ts
export async function fetchReport(runId: string): Promise<Report | null> {
  const res = await fetch(`/api/runs/${runId}/report`);
  if (res.status === 404) return null;
  return jsonOrThrow(res, 'fetchReport');
}
```

- [ ] **Step 4: GREEN** (web 9 + 2 = 11).
- [ ] **Step 5: Report.tsx**

```tsx
import { useEffect, useState } from 'react';
import type { Report } from '@ringq/shared';
import { fetchReport } from './api.js';

export function Report({ runId }: { runId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetchReport(runId).then(setReport).catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (!report) return null;

  const pass = report.verdict === 'pass';
  return (
    <section style={{ marginTop: 24 }}>
      <h2>QA 리포트 <button onClick={load}>새로고침</button></h2>
      <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 6, color: '#fff', background: pass ? '#16a34a' : '#b00020', fontWeight: 700 }}>
        {report.verdict.toUpperCase()}
      </div>
      <p>총 {report.total}건 · critical {report.critical} · major {report.major} · minor {report.minor}</p>
      {report.suggestion && (
        <details open>
          <summary>수정 가이드</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: '#f6f8fa', padding: 12, borderRadius: 6 }}>{report.suggestion}</pre>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 6: App.tsx** — `import { Report } from './Report.js';` + done일 때 `{run && done && <Report runId={run.id} />}`를 Findings 위에 추가.
- [ ] **Step 7: build** — `pnpm --filter @ringq/web test && pnpm --filter @ringq/web build`.
- [ ] **Step 8: Commit** `✨ ringq: web QA 리포트 뷰(verdict 배지·집계·수정 가이드) 추가`

---

### Task 8: README + e2e 검증

- [ ] **Step 1: README "현재 상태"** → Plan 5(전체 파이프라인 완성: 생성→캡처→비교→리포트+수정가이드; reporting 동작).
- [ ] **Step 2: 전체** — `pnpm -r test && tsc && pnpm --filter @ringq/web build`.
- [ ] **Step 3: e2e** — `pnpm --filter @ringq/server test pipeline app report` (resume가 reporting까지 → getReport 검증).
- [ ] **Step 4: data 미커밋 확인**.
- [ ] **Step 5: Commit** `📑 ringq: Plan 5(리포트) README 업데이트`

---

## Self-Review

- 리포트(집계+verdict) → Task 2; 영속 → Task 4; reporting 실연결 → Task 5; 노출 → Task 6+7. ✅
- 경량 LLM 수정 가이드(결정 B, repo 접근 없음, 베스트에포트, 포트 주입) → Task 3 + Task 5. ✅
- 외부 의존 주입/fake 테스트 → Task 3/5. ✅
- 타입 일관성: `Report`/`Verdict`(shared) → builder/store/api/web 동일. `FixSuggester`(Task 3) → pipeline/index 동일. `createPipeline(deps{...,suggester})` → pipeline/app.test/index 일치.
- 태스크 경계: Task 5가 createPipeline 시그니처 변경 → pipeline.test/app.test/index 같은 커밋 갱신(Plan 2~4 동일 패턴).
- 범위 밖: 완전한 git-diff 코드 제안(결정 A의 무거운 경로)은 후속.
