# RingQ-Bot Plan 1 · 워킹 스켈레톤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run을 생성하면 잡 워커가 Phase를 순차 진행하며 SSE로 진행상황을 스트리밍하고, React 대시보드가 입력→실행→진행을 한 화면에서 보여주는 **end-to-end로 동작하는 앱 골격**을 만든다. (실제 QA 로직은 Plan 2~5에서 채움 — Plan 1은 각 Phase를 스텁으로 통과시킨다.)

**Architecture:** pnpm 모노레포. `packages/shared`(zod 타입) ← `apps/server`(Fastify + 인메모리 잡 큐/워커 + better-sqlite3 store + SSE) ← `apps/web`(Vite+React 대시보드). 백엔드는 서버리스가 아닌 상시 Node 프로세스 + 잡 워커 구조라 장시간 Playwright/LLM 작업을 수용하고 추후 Railway/Fly로 이식 가능.

**Tech Stack:** TypeScript(ESM) / pnpm workspace / Vite + React / Fastify v5 / better-sqlite3 / zod / vitest.

## Global Constraints

- 언어: TypeScript, ESM(`"type": "module"`), Node 22 (`node v22.22.2` 확인됨).
- 패키지 매니저: pnpm 10 (`pnpm-workspace.yaml` 기반 워크스페이스).
- 테스트: vitest. 테스트 파일은 대상과 같은 패키지의 `src/**/*.test.ts`.
- 시크릿 절대 커밋 금지. `.env`는 gitignore, `.env.example`만 커밋.
- 커밋 메시지 형식: `✨ ringq: <내용>` (신규 기능) / `📑 ringq: <내용>` (문서). Co-Authored-By 라인 포함.
- 모든 도메인 타입은 `@ringq/shared`에서만 정의하고 import해서 쓴다 (DRY).

---

### Task 1: 모노레포 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Consumes: 없음 (최초 태스크).
- Produces: 루트 스크립트 `pnpm -r build`, `pnpm -r test`. 워크스페이스 글롭 `packages/*`, `apps/*`.

- [ ] **Step 1: 루트 `package.json` 작성**

```json
{
  "name": "ringq-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev": "pnpm --parallel -r dev"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml` 작성**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: `tsconfig.base.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 4: `.gitignore` 작성**

```
node_modules/
dist/
.env
*.db
data/
playwright-report/
test-results/
.context/
```

- [ ] **Step 5: `.env.example` 작성**

```
# Anthropic
ANTHROPIC_API_KEY=

# Figma
FIGMA_TOKEN=

# 대상 사이트 로그인 (QA 대상)
SITE_USERNAME=
SITE_PASSWORD=

# 서버 포트
PORT=4000
```

- [ ] **Step 6: 워크스페이스 설치 확인**

Run: `pnpm install`
Expected: 에러 없이 완료 (아직 패키지 없어도 lockfile 생성됨).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: 모노레포 스캐폴딩(pnpm workspace + tsconfig)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `@ringq/shared` 도메인 타입 (zod)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces (다른 태스크가 import):
  - `RunPhase` (zod enum + type): `'queued' | 'generating-cases' | 'running' | 'comparing' | 'reporting' | 'done' | 'failed'`
  - `RunStatus`: `'active' | 'done' | 'failed'`
  - `ProjectInput` (type + `ProjectInputSchema`): `{ figmaLinks: string[]; siteUrl: string; gitUrl?: string }`
  - `Run` (type): `{ id: string; siteUrl: string; figmaLinks: string[]; gitUrl?: string; phase: RunPhase; status: RunStatus; createdAt: string }`
  - `ProgressEvent` (type + `ProgressEventSchema`): `{ runId: string; phase: RunPhase; message: string; at: string }`

- [ ] **Step 1: 패키지 메타 작성** — `packages/shared/package.json`

```json
{
  "name": "@ringq/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json` 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: 의존성 설치**

Run: `pnpm install`
Expected: `@ringq/shared`에 zod/vitest/typescript 설치 완료.

- [ ] **Step 4: 실패하는 테스트 작성** — `packages/shared/src/index.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ProjectInputSchema, ProgressEventSchema } from './index.js';

describe('ProjectInputSchema', () => {
  it('유효한 입력을 통과시킨다', () => {
    const parsed = ProjectInputSchema.parse({
      figmaLinks: ['https://figma.com/file/abc'],
      siteUrl: 'https://example.com',
    });
    expect(parsed.figmaLinks).toHaveLength(1);
    expect(parsed.gitUrl).toBeUndefined();
  });

  it('figmaLinks가 비면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: [], siteUrl: 'https://example.com' }),
    ).toThrow();
  });

  it('siteUrl이 URL이 아니면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: ['https://figma.com/x'], siteUrl: 'not-a-url' }),
    ).toThrow();
  });
});

describe('ProgressEventSchema', () => {
  it('phase enum을 검증한다', () => {
    expect(() =>
      ProgressEventSchema.parse({ runId: 'r1', phase: 'invalid', message: 'x', at: 'now' }),
    ).toThrow();
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: FAIL — `./index.js`에서 export를 찾을 수 없음.

- [ ] **Step 6: 구현 작성** — `packages/shared/src/index.ts`

```ts
import { z } from 'zod';

export const RunPhaseSchema = z.enum([
  'queued',
  'generating-cases',
  'running',
  'comparing',
  'reporting',
  'done',
  'failed',
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunStatusSchema = z.enum(['active', 'done', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ProjectInputSchema = z.object({
  figmaLinks: z.array(z.string().url()).min(1),
  siteUrl: z.string().url(),
  gitUrl: z.string().url().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const RunSchema = z.object({
  id: z.string(),
  siteUrl: z.string(),
  figmaLinks: z.array(z.string()),
  gitUrl: z.string().optional(),
  phase: RunPhaseSchema,
  status: RunStatusSchema,
  createdAt: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const ProgressEventSchema = z.object({
  runId: z.string(),
  phase: RunPhaseSchema,
  message: z.string(),
  at: z.string(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: @ringq/shared 도메인 타입(zod) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `apps/server` store (better-sqlite3)

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/store.ts`
- Test: `apps/server/src/store.test.ts`

**Interfaces:**
- Consumes: `@ringq/shared`의 `ProjectInput`, `Run`, `RunPhase`, `RunStatus`.
- Produces:
  - `createStore(dbPath: string): Store` — `dbPath`가 `':memory:'`면 인메모리.
  - `Store` 인터페이스:
    - `createRun(input: ProjectInput): Run` — id는 `run_<timestamp>_<rand>`, phase=`'queued'`, status=`'active'`, createdAt=ISO 문자열.
    - `getRun(id: string): Run | undefined`
    - `updateRun(id: string, patch: Partial<Pick<Run, 'phase' | 'status'>>): Run` — 없는 id면 throw `Error('run not found: <id>')`.
    - `listRuns(): Run[]` — createdAt 내림차순.

- [ ] **Step 1: 패키지 메타 작성** — `apps/server/package.json`

```json
{
  "name": "@ringq/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@ringq/shared": "workspace:*",
    "better-sqlite3": "^11.3.0",
    "fastify": "^5.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `apps/server/tsconfig.json` 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: 의존성 설치**

Run: `pnpm install`
Expected: better-sqlite3 네이티브 빌드 포함 완료.

- [ ] **Step 4: 실패하는 테스트 작성** — `apps/server/src/store.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createStore } from './store.js';

const input = { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' };

describe('store', () => {
  it('Run을 생성하면 queued/active 상태로 시작한다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    expect(run.id).toMatch(/^run_/);
    expect(run.phase).toBe('queued');
    expect(run.status).toBe('active');
    expect(run.siteUrl).toBe(input.siteUrl);
  });

  it('getRun으로 조회된다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    expect(store.getRun(run.id)?.id).toBe(run.id);
    expect(store.getRun('nope')).toBeUndefined();
  });

  it('updateRun으로 phase/status를 갱신한다', () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    const updated = store.updateRun(run.id, { phase: 'running' });
    expect(updated.phase).toBe('running');
    expect(store.getRun(run.id)?.phase).toBe('running');
  });

  it('없는 id를 update하면 throw한다', () => {
    const store = createStore(':memory:');
    expect(() => store.updateRun('nope', { phase: 'done' })).toThrow(/run not found/);
  });

  it('listRuns는 최신순으로 반환한다', () => {
    const store = createStore(':memory:');
    const a = store.createRun(input);
    const b = store.createRun(input);
    const ids = store.listRuns().map((r) => r.id);
    expect(ids[0]).toBe(b.id);
    expect(ids[1]).toBe(a.id);
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test`
Expected: FAIL — `./store.js` 없음.

- [ ] **Step 6: 구현 작성** — `apps/server/src/store.ts`

```ts
import Database from 'better-sqlite3';
import type { ProjectInput, Run, RunPhase, RunStatus } from '@ringq/shared';

export interface Store {
  createRun(input: ProjectInput): Run;
  getRun(id: string): Run | undefined;
  updateRun(id: string, patch: Partial<Pick<Run, 'phase' | 'status'>>): Run;
  listRuns(): Run[];
}

interface Row {
  id: string;
  site_url: string;
  figma_links: string;
  git_url: string | null;
  phase: string;
  status: string;
  created_at: string;
  seq: number;
}

function rowToRun(row: Row): Run {
  return {
    id: row.id,
    siteUrl: row.site_url,
    figmaLinks: JSON.parse(row.figma_links) as string[],
    gitUrl: row.git_url ?? undefined,
    phase: row.phase as RunPhase,
    status: row.status as RunStatus,
    createdAt: row.created_at,
  };
}

export function createStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      site_url TEXT NOT NULL,
      figma_links TEXT NOT NULL,
      git_url TEXT,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return {
    createRun(input) {
      const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO runs (id, site_url, figma_links, git_url, phase, status, created_at)
         VALUES (@id, @site_url, @figma_links, @git_url, @phase, @status, @created_at)`,
      ).run({
        id,
        site_url: input.siteUrl,
        figma_links: JSON.stringify(input.figmaLinks),
        git_url: input.gitUrl ?? null,
        phase: 'queued',
        status: 'active',
        created_at: createdAt,
      });
      return this.getRun(id)!;
    },
    getRun(id) {
      const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Row | undefined;
      return row ? rowToRun(row) : undefined;
    },
    updateRun(id, patch) {
      const existing = this.getRun(id);
      if (!existing) throw new Error(`run not found: ${id}`);
      const next: Run = { ...existing, ...patch };
      db.prepare(`UPDATE runs SET phase = ?, status = ? WHERE id = ?`).run(
        next.phase,
        next.status,
        id,
      );
      return next;
    },
    listRuns() {
      const rows = db.prepare(`SELECT * FROM runs ORDER BY seq DESC`).all() as Row[];
      return rows.map(rowToRun);
    },
  };
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: server store(better-sqlite3) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: 진행 이벤트 버스 + 인메모리 잡 큐/워커

**Files:**
- Create: `apps/server/src/events.ts`
- Create: `apps/server/src/queue.ts`
- Test: `apps/server/src/queue.test.ts`

**Interfaces:**
- Consumes: `@ringq/shared`의 `ProgressEvent`.
- Produces:
  - `events.ts`: `runEvents: EventEmitter`, `emitProgress(ev: ProgressEvent): void` (이벤트명 = `ev.runId`), `now(): string` (ISO 문자열).
  - `queue.ts`: `createQueue(handler: (runId: string) => Promise<void>): JobQueue`.
    - `JobQueue`: `enqueue(runId: string): void`, `size(): number`, `onIdle(): Promise<void>` (큐가 빌 때까지 대기, 테스트용).
    - 직렬 처리(동시 1건). handler가 throw해도 큐는 멈추지 않고 다음 잡 진행.

- [ ] **Step 1: 이벤트 버스 작성** — `apps/server/src/events.ts`

```ts
import { EventEmitter } from 'node:events';
import type { ProgressEvent } from '@ringq/shared';

export const runEvents = new EventEmitter();
runEvents.setMaxListeners(0);

export function emitProgress(ev: ProgressEvent): void {
  runEvents.emit(ev.runId, ev);
}

export function now(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `apps/server/src/queue.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createQueue } from './queue.js';

describe('queue', () => {
  it('잡을 직렬로 처리하고 onIdle로 완료를 기다린다', async () => {
    const processed: string[] = [];
    const q = createQueue(async (runId) => {
      await new Promise((r) => setTimeout(r, 5));
      processed.push(runId);
    });
    q.enqueue('a');
    q.enqueue('b');
    await q.onIdle();
    expect(processed).toEqual(['a', 'b']);
    expect(q.size()).toBe(0);
  });

  it('handler가 throw해도 다음 잡을 계속 처리한다', async () => {
    const processed: string[] = [];
    const q = createQueue(async (runId) => {
      if (runId === 'bad') throw new Error('boom');
      processed.push(runId);
    });
    q.enqueue('bad');
    q.enqueue('good');
    await q.onIdle();
    expect(processed).toEqual(['good']);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test queue`
Expected: FAIL — `./queue.js` 없음.

- [ ] **Step 4: 구현 작성** — `apps/server/src/queue.ts`

```ts
export interface JobQueue {
  enqueue(runId: string): void;
  size(): number;
  onIdle(): Promise<void>;
}

export function createQueue(handler: (runId: string) => Promise<void>): JobQueue {
  const jobs: string[] = [];
  let running = false;
  const idleWaiters: Array<() => void> = [];

  function resolveIdle() {
    while (idleWaiters.length) idleWaiters.shift()!();
  }

  async function drain() {
    if (running) return;
    running = true;
    while (jobs.length) {
      const runId = jobs.shift()!;
      try {
        await handler(runId);
      } catch (err) {
        // handler가 실패를 store/이벤트로 기록한다. 큐는 멈추지 않는다.
        console.error(`[queue] job ${runId} failed:`, err);
      }
    }
    running = false;
    resolveIdle();
  }

  return {
    enqueue(runId) {
      jobs.push(runId);
      void drain();
    },
    size() {
      return jobs.length;
    },
    onIdle() {
      if (!running && jobs.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test queue`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/events.ts apps/server/src/queue.ts apps/server/src/queue.test.ts
git commit -m "$(printf '✨ ringq: 진행 이벤트 버스 + 인메모리 잡 큐/워커 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: 스켈레톤 파이프라인 (Phase 스텁)

**Files:**
- Create: `apps/server/src/pipeline.ts`
- Test: `apps/server/src/pipeline.test.ts`

**Interfaces:**
- Consumes: `Store`(Task 3), `emitProgress`/`now`(Task 4), `@ringq/shared`의 `RunPhase`.
- Produces:
  - `createSkeletonPipeline(store: Store, opts?: { delayMs?: number }): (runId: string) => Promise<void>`
  - 동작: `['generating-cases','running','comparing','reporting']`를 순서대로 진행하며 각 단계마다 `store.updateRun(runId,{phase})` + `emitProgress`. 마지막에 `phase:'done', status:'done'`. 도중 에러 시 `phase:'failed', status:'failed'` 기록 후 rethrow.
  - `opts.delayMs` 기본 0 (테스트는 0, 실제 구동은 데모 가독성용으로 300 등).

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/pipeline.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createStore } from './store.js';
import { createSkeletonPipeline } from './pipeline.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' };

describe('skeleton pipeline', () => {
  it('모든 phase를 순서대로 진행하고 done으로 끝낸다', async () => {
    const store = createStore(':memory:');
    const run = store.createRun(input);
    const phases: string[] = [];
    const listener = (ev: ProgressEvent) => phases.push(ev.phase);
    runEvents.on(run.id, listener);

    await createSkeletonPipeline(store, { delayMs: 0 })(run.id);

    runEvents.off(run.id, listener);
    expect(phases).toEqual(['generating-cases', 'running', 'comparing', 'reporting', 'done']);
    const final = store.getRun(run.id)!;
    expect(final.phase).toBe('done');
    expect(final.status).toBe('done');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test pipeline`
Expected: FAIL — `./pipeline.js` 없음.

- [ ] **Step 3: 구현 작성** — `apps/server/src/pipeline.ts`

```ts
import type { RunPhase } from '@ringq/shared';
import type { Store } from './store.js';
import { emitProgress, now } from './events.js';

const STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'generating-cases', message: 'Figma에서 테스트 케이스 생성 중...' },
  { phase: 'running', message: 'Playwright로 사이트 실행 중...' },
  { phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...' },
  { phase: 'reporting', message: '리포트 작성 중...' },
];

export function createSkeletonPipeline(store: Store, opts: { delayMs?: number } = {}) {
  const delayMs = opts.delayMs ?? 0;
  return async (runId: string): Promise<void> => {
    try {
      for (const step of STEPS) {
        store.updateRun(runId, { phase: step.phase });
        emitProgress({ runId, phase: step.phase, message: step.message, at: now() });
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
      store.updateRun(runId, { phase: 'done', status: 'done' });
      emitProgress({ runId, phase: 'done', message: 'QA 완료', at: now() });
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

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test pipeline`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/pipeline.test.ts
git commit -m "$(printf '✨ ringq: 스켈레톤 파이프라인(Phase 스텁) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Fastify API + SSE + 서버 부팅

**Files:**
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Test: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: `createStore`, `createQueue`, `createSkeletonPipeline`, `runEvents`, `@ringq/shared`(`ProjectInputSchema`).
- Produces:
  - `buildApp(deps: { store: Store; queue: JobQueue }): FastifyInstance`
    - `POST /api/runs` — body를 `ProjectInputSchema`로 검증(실패 시 400 + `{ error }`). 통과 시 `store.createRun` → `queue.enqueue(run.id)` → 201 + `Run`.
    - `GET /api/runs` — `store.listRuns()` 반환.
    - `GET /api/runs/:id` — `store.getRun(id)`; 없으면 404 `{ error: 'not found' }`.
    - `GET /api/runs/:id/events` — SSE. 연결 즉시 현재 `Run`을 `event: snapshot`으로 1회 전송, 이후 `runEvents`의 진행 이벤트를 `event: progress`로 전송. `phase`가 `done`/`failed`면 스트림 종료.
  - `index.ts` — `.env` 로드, store(`data/ringq.db`)·queue(skeleton, delayMs 300) 조립 후 `PORT`(기본 4000)에서 listen.

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/app.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createSkeletonPipeline } from './pipeline.js';

function setup() {
  const store = createStore(':memory:');
  const queue = createQueue(createSkeletonPipeline(store, { delayMs: 0 }));
  const app = buildApp({ store, queue });
  return { store, queue, app };
}

describe('POST /api/runs', () => {
  it('유효한 입력이면 201과 Run을 반환하고 큐에 넣는다', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { figmaLinks: ['https://figma.com/file/abc'], siteUrl: 'https://example.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^run_/);
    expect(body.phase).toBe('queued');
  });

  it('잘못된 입력이면 400을 반환한다', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { figmaLinks: [], siteUrl: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });
});

describe('GET /api/runs/:id', () => {
  it('없는 id면 404를 반환한다', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/runs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('생성된 Run을 조회한다', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' });
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(run.id);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: FAIL — `./app.js` 없음.

- [ ] **Step 3: 앱 구현 작성** — `apps/server/src/app.ts`

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { ProjectInputSchema } from '@ringq/shared';
import type { Store } from './store.js';
import type { JobQueue } from './queue.js';
import { runEvents } from './events.js';
import type { ProgressEvent } from '@ringq/shared';

export function buildApp(deps: { store: Store; queue: JobQueue }): FastifyInstance {
  const { store, queue } = deps;
  const app = Fastify({ logger: false });

  app.post('/api/runs', async (req, reply) => {
    const parsed = ProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const run = store.createRun(parsed.data);
    queue.enqueue(run.id);
    return reply.code(201).send(run);
  });

  app.get('/api/runs', async () => store.listRuns());

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: 'not found' });
    return run;
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (req, reply) => {
    const run = store.getRun(req.params.id);
    if (!run) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);

    const onProgress = (ev: ProgressEvent) => {
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(ev)}\n\n`);
      if (ev.phase === 'done' || ev.phase === 'failed') {
        runEvents.off(req.params.id, onProgress);
        reply.raw.end();
      }
    };
    runEvents.on(req.params.id, onProgress);
    req.raw.on('close', () => runEvents.off(req.params.id, onProgress));
  });

  return app;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: PASS (4 tests).

- [ ] **Step 5: 부팅 엔트리 작성** — `apps/server/src/index.ts`

```ts
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { createStore } from './store.js';
import { createQueue } from './queue.js';
import { createSkeletonPipeline } from './pipeline.js';

mkdirSync('data', { recursive: true });
const store = createStore('data/ringq.db');
const queue = createQueue(createSkeletonPipeline(store, { delayMs: 300 }));
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

- [ ] **Step 6: `dotenv` 의존성 추가 후 설치**

`apps/server/package.json`의 `dependencies`에 `"dotenv": "^16.4.0"` 추가 후:

Run: `pnpm install`
Expected: dotenv 설치 완료.

- [ ] **Step 7: 서버 부팅 스모크 테스트**

Run: `pnpm --filter @ringq/server exec tsx src/index.ts &` 후 `sleep 2 && curl -s -X POST localhost:4000/api/runs -H 'content-type: application/json' -d '{"figmaLinks":["https://figma.com/x"],"siteUrl":"https://example.com"}'`
Expected: 201 JSON(`run_...`) 출력. 확인 후 `kill %1`.

- [ ] **Step 8: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: Fastify API + SSE 진행 스트림 + 서버 부팅 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: `apps/web` React 대시보드 (입력 → 실행 → 진행)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.tsx`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: 서버 `POST /api/runs`, `GET /api/runs/:id/events`(SSE). `@ringq/shared` 타입.
- Produces: 브라우저에서 입력 폼(figma 링크 1개, siteUrl, 선택 gitUrl) → "QA 실행" → 생성된 Run의 SSE를 구독해 phase 진행을 리스트로 표시.
- Vite dev 프록시: `/api` → `http://localhost:4000`.

- [ ] **Step 1: 패키지 메타 작성** — `apps/web/package.json`

```json
{
  "name": "@ringq/web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@ringq/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `apps/web/tsconfig.json` 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: `apps/web/vite.config.ts` 작성**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
```

- [ ] **Step 4: `apps/web/index.html` 작성**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RingQ-Bot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 의존성 설치**

Run: `pnpm install`
Expected: react/vite 등 설치 완료.

- [ ] **Step 6: 실패하는 테스트 작성** — `apps/web/src/api.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRun } from './api.js';

afterEach(() => vi.restoreAllMocks());

describe('createRun', () => {
  it('POST /api/runs로 입력을 보내고 Run을 반환한다', async () => {
    const fakeRun = { id: 'run_1', phase: 'queued' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeRun,
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = await createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(run.id).toBe('run_1');
  });

  it('서버가 실패하면 throw한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) }),
    );
    await expect(
      createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm --filter @ringq/web test`
Expected: FAIL — `./api.js` 없음.

- [ ] **Step 8: API 클라이언트 작성** — `apps/web/src/api.ts`

```ts
import type { ProjectInput, Run } from '@ringq/shared';

export async function createRun(input: ProjectInput): Promise<Run> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(`createRun 실패: ${JSON.stringify(body.error ?? res.status)}`);
  }
  return (await res.json()) as Run;
}
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm --filter @ringq/web test`
Expected: PASS (2 tests).

- [ ] **Step 10: 대시보드 컴포넌트 작성** — `apps/web/src/App.tsx`

```tsx
import { useState } from 'react';
import type { ProgressEvent, Run } from '@ringq/shared';
import { createRun } from './api.js';

export function App() {
  const [figmaLink, setFigmaLink] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    setError(null);
    setEvents([]);
    try {
      const created = await createRun({
        figmaLinks: [figmaLink],
        siteUrl,
        gitUrl: gitUrl || undefined,
      });
      setRun(created);
      const es = new EventSource(`/api/runs/${created.id}/events`);
      es.addEventListener('progress', (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setEvents((prev) => [...prev, ev]);
        if (ev.phase === 'done' || ev.phase === 'failed') es.close();
      });
      es.onerror = () => es.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : '실행 실패');
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>🤖 RingQ-Bot</h1>
      <p>Figma 기획서를 정답지로 사이트를 자동 QA합니다.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        <input placeholder="Figma 링크" value={figmaLink} onChange={(e) => setFigmaLink(e.target.value)} />
        <input placeholder="대상 사이트 URL" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
        <input placeholder="(선택) Git repo URL" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
        <button onClick={onRun} disabled={!figmaLink || !siteUrl}>QA 실행</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {run && (
        <section style={{ marginTop: 24 }}>
          <h2>진행 상황 · {run.id}</h2>
          <ol>
            {events.map((ev, i) => (
              <li key={i}>
                <strong>{ev.phase}</strong> — {ev.message}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 11: 엔트리 작성** — `apps/web/src/main.tsx`

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 12: 빌드 검증**

Run: `pnpm --filter @ringq/web build`
Expected: 타입 에러 없이 `dist/` 생성.

- [ ] **Step 13: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: web 대시보드(입력→실행→SSE 진행) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: end-to-end 수동 검증 + README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 전체 앱.
- Produces: `pnpm dev` 한 줄로 server(4000) + web(5173) 동시 구동되는 실행 안내.

- [ ] **Step 1: `README.md` 작성**

````markdown
# RingQ-Bot

Figma 기획서를 정답지로 삼아 실제 사이트의 UI 일치 + 사용자 플로우를 자동 QA하는 로컬 우선 대시보드.

## 개발 실행

```bash
cp .env.example .env   # 키 채우기 (Plan 2부터 필요)
pnpm install
pnpm dev               # server :4000 + web :5173 동시 구동
```

브라우저에서 http://localhost:5173 접속 → Figma 링크 + 사이트 URL 입력 → "QA 실행".

> **현재 상태(Plan 1):** Phase는 스텁으로 진행상황만 스트리밍됩니다. 실제 Figma 분석/Playwright 실행/비교는 Plan 2~5에서 구현됩니다.

## 테스트

```bash
pnpm test
```
````

- [ ] **Step 2: 전체 테스트 통과 확인**

Run: `pnpm -r test`
Expected: shared/server/web 전 패키지 PASS.

- [ ] **Step 3: end-to-end 수동 검증**

Run: `pnpm dev` 후 브라우저에서 http://localhost:5173 접속 → Figma 링크 `https://figma.com/file/x`, 사이트 `https://example.com` 입력 → "QA 실행" 클릭.
Expected: 진행 리스트에 `generating-cases → running → comparing → reporting → done` 5개 항목이 약 0.3초 간격으로 차례로 나타남. 확인 후 `Ctrl+C`로 종료.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(printf '📑 ringq: README + 실행 안내 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review 결과

**Spec coverage (Plan 1 범위 한정):**
- 아키텍처(상시 Node + 잡 워커, 서버리스 배제) → Task 4, 6 ✅
- 데이터 모델(Run) → Task 2, 3 ✅
- 대시보드(입력→실행→진행) → Task 7 ✅
- SSE 진행 스트림 → Task 6 ✅
- 에러 격리(handler throw에도 큐 지속, phase=failed 기록) → Task 4, 5 ✅
- 테스트 전략(단위 + 부팅 스모크 + e2e 수동) → 전 태스크 ✅
- **Plan 1 범위 밖(의도된 미구현)**: figma-client / case-generator / runner / comparator / code-suggester / report / TestCase·Finding 모델 → Plan 2~5에서 구현. (스켈레톤 Phase 스텁으로 자리만 확보)

**Placeholder scan:** 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency:** `createStore`/`createQueue`/`createSkeletonPipeline`/`buildApp`/`createRun` 시그니처가 태스크 간 일치. `Run`/`ProjectInput`/`ProgressEvent`/`RunPhase`는 전부 `@ringq/shared`에서 단일 정의 후 import.
