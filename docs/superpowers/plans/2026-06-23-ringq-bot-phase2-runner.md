# RingQ-Bot Plan 3 · Phase 2 (Playwright runner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `resume` 파이프라인의 `running` 스텁을 실제 Playwright runner로 교체한다 — 브라우저로 사이트에 접속, (자격증명이 있으면) 휴리스틱 로그인, 확정된 테스트 케이스마다 화면 스크린샷 + DOM(텍스트·요소 목록)을 추출해 저장한다. 이 캡처 결과가 Plan 4(comparator)의 입력이 된다.

**Architecture:** runner는 `BrowserSession` 포트 뒤에서 동작한다(의존성 주입). 실제 구현은 Playwright(chromium) 백엔드, 테스트는 스크립트된 fake 세션으로 네트워크/브라우저 없이 검증한다. 단일 페이지 모드(결정 A): UI 케이스는 `siteUrl`(+선택적 `routePath`)에서 캡처, 플로우 케이스는 click step으로 이동 후 캡처. 로그인은 선택적(결정 C): `SITE_USERNAME`/`SITE_PASSWORD`가 있으면 휴리스틱 폼 로그인 시도, 없으면 스킵. 케이스 단위 에러 격리(한 케이스 실패가 Run을 죽이지 않음). 스크린샷은 `data/runs/<runId>/<caseId>.png`에 영속.

**Tech Stack:** 기존 + `playwright`(chromium). 비교/리포트(comparing/reporting)는 Plan 4~5까지 스텁 유지.

## Global Constraints

- 언어: TypeScript, ESM, Node 22. 테스트: vitest, `src/**/*.test.ts`.
- 모든 도메인 타입은 `@ringq/shared`에서만 정의 후 import (DRY).
- 외부 의존(Playwright 브라우저)은 `BrowserSession`/`BrowserDriver` 인터페이스 뒤로 주입. **테스트는 절대 실제 브라우저/네트워크를 띄우지 않는다** — fake 세션 사용. 실제 Playwright 구현(`playwright.ts`)은 타입 컴파일만 검증(단위 테스트 없음).
- 케이스 단위 에러 격리: 한 케이스 캡처가 throw해도 그 케이스에 `error`를 기록하고 다음 케이스를 계속 처리. 단, 로그인 자체가 실패하면(`'failed'`) Run을 실패시킨다.
- 아티팩트(스크린샷)는 디스크에 영속. `data/`는 gitignore — 절대 커밋 금지. 시크릿(`.env`) 커밋 금지.
- 커밋 메시지 형식: `✨`(신규)/`🔨`(수정)/`♻️`(리팩토링)/`🧪`(테스트)/`📑`(문서) `ringq: <내용>` + Co-Authored-By 라인:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 모든 pnpm 명령은 레포 루트 `/Users/kimsunil/conductor/workspaces/ringq-bot-v1/dubai-v1`에서 실행(하위 디렉토리로 cwd 이동 금지).

---

### Task 1: `@ringq/shared` — RunCapture 타입 + TestCase.routePath

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts` (append)

**Interfaces:**
- Consumes: 기존 `TestCaseTypeSchema`, `TestCaseSchema`.
- Produces:
  - `TestCaseSchema`에 `routePath: z.string().optional()` 추가(단일 페이지 모드의 선택적 경로).
  - `RunCaptureSchema` = `z.object({ caseId, runId, type: TestCaseTypeSchema, url: z.string(), texts: z.array(z.string()), elements: z.array(z.string()), screenshotPath: z.string().optional(), flowOk: z.boolean().optional(), error: z.string().optional() })` → type `RunCapture`.

- [ ] **Step 1: 실패하는 테스트 추가** — `packages/shared/src/index.test.ts` 끝에 append

```ts
import { RunCaptureSchema, TestCaseSchema as TCSchema } from './index.js';

describe('RunCaptureSchema', () => {
  it('UI 캡처를 검증한다', () => {
    const c = RunCaptureSchema.parse({
      caseId: 'tc_1', runId: 'run_1', type: 'ui',
      url: 'https://e.com', texts: ['로그인'], elements: ['button'],
      screenshotPath: 'data/runs/run_1/tc_1.png',
    });
    expect(c.texts).toContain('로그인');
  });

  it('flow 캡처의 flowOk와 error를 허용한다', () => {
    const c = RunCaptureSchema.parse({
      caseId: 'tc_2', runId: 'run_1', type: 'flow',
      url: 'https://e.com', texts: [], elements: [], flowOk: false, error: 'click 실패',
    });
    expect(c.flowOk).toBe(false);
    expect(c.error).toBe('click 실패');
  });
});

describe('TestCase.routePath', () => {
  it('routePath를 허용한다', () => {
    const c = TCSchema.parse({
      id: 'tc_1', runId: 'run_1', type: 'ui', source: 'figma', status: 'draft',
      title: '로그인 UI', routePath: '/login',
    });
    expect(c.routePath).toBe('/login');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: FAIL — `RunCaptureSchema` 없음, routePath 미인식 통과 안 함(실제로 optional이라 통과할 수 있으니 RunCaptureSchema import 실패로 FAIL).

- [ ] **Step 3: 구현** — `packages/shared/src/index.ts`

`TestCaseSchema`에 `routePath` 필드 추가(`figmaNodeId` 옆):

```ts
  figmaNodeId: z.string().optional(),
  routePath: z.string().optional(),
```

파일 끝에 추가:

```ts
export const RunCaptureSchema = z.object({
  caseId: z.string(),
  runId: z.string(),
  type: TestCaseTypeSchema,
  url: z.string(),
  texts: z.array(z.string()),
  elements: z.array(z.string()),
  screenshotPath: z.string().optional(),
  flowOk: z.boolean().optional(),
  error: z.string().optional(),
});
export type RunCapture = z.infer<typeof RunCaptureSchema>;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/shared test`
Expected: PASS (기존 8 + 신규 3 = 11).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "$(printf '✨ ringq: shared에 RunCapture 타입 + TestCase.routePath 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `browser` 포트 — BrowserSession 인터페이스 + fake + Playwright 구현

**Files:**
- Create: `apps/server/src/browser/session.ts`
- Create: `apps/server/src/browser/fake.ts`
- Create: `apps/server/src/browser/playwright.ts`
- Test: `apps/server/src/browser/fake.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces:
  - `session.ts`:
    - `CapturedScreen = { texts: string[]; elements: string[]; screenshotPath?: string }`
    - `LoginResult = 'logged-in' | 'no-form' | 'failed'`
    - `BrowserSession = { goto(url: string): Promise<void>; tryLogin(creds: { username: string; password: string }): Promise<LoginResult>; clickByText(text: string): Promise<boolean>; capture(screenshotPath?: string): Promise<CapturedScreen>; close(): Promise<void> }`
    - `BrowserDriver = { open(): Promise<BrowserSession> }`
  - `fake.ts`: `createFakeDriver(script: { login?: LoginResult; clicks?: Record<string, boolean>; screen?: CapturedScreen; gotoError?: string }): BrowserDriver` — 스크립트대로 동작하는 fake. `goto`가 `gotoError` 설정 시 throw, `tryLogin`은 `script.login ?? 'no-form'`, `clickByText(t)`는 `script.clicks?.[t] ?? true`, `capture`는 `script.screen ?? { texts: [], elements: [] }`(screenshotPath 인자 그대로 반영). 호출 기록(`session.calls`)을 노출해 테스트가 검증 가능하게 한다.
  - `playwright.ts`: `createPlaywrightDriver(opts?: { headless?: boolean }): BrowserDriver` — chromium 기반 실제 구현(아래 코드). 단위 테스트 없음(타입 컴파일만).

- [ ] **Step 1: playwright 의존성 추가** — `apps/server/package.json` dependencies에 `"playwright": "^1.61.0"` 추가 후

Run: `pnpm install`
Expected: playwright npm 패키지 설치(브라우저 바이너리는 Task 8/런타임에서 `npx playwright install chromium`).

- [ ] **Step 2: 포트 타입 작성** — `apps/server/src/browser/session.ts`

```ts
export interface CapturedScreen {
  texts: string[];
  elements: string[];
  screenshotPath?: string;
}

export type LoginResult = 'logged-in' | 'no-form' | 'failed';

export interface BrowserSession {
  goto(url: string): Promise<void>;
  tryLogin(creds: { username: string; password: string }): Promise<LoginResult>;
  clickByText(text: string): Promise<boolean>;
  capture(screenshotPath?: string): Promise<CapturedScreen>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  open(): Promise<BrowserSession>;
}
```

- [ ] **Step 3: fake 작성** — `apps/server/src/browser/fake.ts`

```ts
import type { BrowserDriver, BrowserSession, CapturedScreen, LoginResult } from './session.js';

export interface FakeScript {
  login?: LoginResult;
  clicks?: Record<string, boolean>;
  screen?: CapturedScreen;
  gotoError?: string;
}

export interface FakeSession extends BrowserSession {
  calls: string[];
}

export function createFakeDriver(script: FakeScript = {}): BrowserDriver {
  return {
    async open(): Promise<FakeSession> {
      const calls: string[] = [];
      return {
        calls,
        async goto(url) {
          calls.push(`goto:${url}`);
          if (script.gotoError) throw new Error(script.gotoError);
        },
        async tryLogin() {
          calls.push('tryLogin');
          return script.login ?? 'no-form';
        },
        async clickByText(text) {
          calls.push(`click:${text}`);
          return script.clicks?.[text] ?? true;
        },
        async capture(screenshotPath) {
          calls.push(`capture:${screenshotPath ?? ''}`);
          return { ...(script.screen ?? { texts: [], elements: [] }), screenshotPath };
        },
        async close() {
          calls.push('close');
        },
      };
    },
  };
}
```

- [ ] **Step 4: 실패하는 테스트 작성** — `apps/server/src/browser/fake.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createFakeDriver, type FakeSession } from './fake.js';

describe('fake browser driver', () => {
  it('스크립트대로 동작하고 호출을 기록한다', async () => {
    const driver = createFakeDriver({
      login: 'logged-in',
      clicks: { '로그인 버튼': true, '없는버튼': false },
      screen: { texts: ['환영'], elements: ['button'] },
    });
    const s = (await driver.open()) as FakeSession;
    await s.goto('https://e.com');
    expect(await s.tryLogin({ username: 'u', password: 'p' })).toBe('logged-in');
    expect(await s.clickByText('로그인 버튼')).toBe(true);
    expect(await s.clickByText('없는버튼')).toBe(false);
    const cap = await s.capture('data/x.png');
    expect(cap.texts).toEqual(['환영']);
    expect(cap.screenshotPath).toBe('data/x.png');
    await s.close();
    expect(s.calls).toEqual([
      'goto:https://e.com', 'tryLogin', 'click:로그인 버튼', 'click:없는버튼', 'capture:data/x.png', 'close',
    ]);
  });

  it('gotoError 설정 시 goto가 throw한다', async () => {
    const driver = createFakeDriver({ gotoError: 'net fail' });
    const s = await driver.open();
    await expect(s.goto('https://e.com')).rejects.toThrow('net fail');
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test browser`
Expected: FAIL — `./fake.js` 없음.

- [ ] **Step 6: Playwright 실제 구현 작성** — `apps/server/src/browser/playwright.ts`

```ts
import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserDriver, BrowserSession, CapturedScreen, LoginResult } from './session.js';

class PlaywrightSession implements BrowserSession {
  constructor(
    private browser: Browser,
    private page: Page,
  ) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  async tryLogin(creds: { username: string; password: string }): Promise<LoginResult> {
    const pw = this.page.locator('input[type=password]');
    if ((await pw.count()) === 0) return 'no-form';
    try {
      const user = this.page
        .locator('input[type=email], input[type=text], input[name*=user i], input[name*=email i], input[name*=id i]')
        .first();
      await user.fill(creds.username);
      await pw.first().fill(creds.password);
      const btn = this.page
        .locator('button[type=submit], input[type=submit], button:has-text("로그인"), button:has-text("Login")')
        .first();
      if ((await btn.count()) > 0) await btn.click();
      else await pw.first().press('Enter');
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      return (await this.page.locator('input[type=password]').count()) === 0 ? 'logged-in' : 'failed';
    } catch {
      return 'failed';
    }
  }

  async clickByText(text: string): Promise<boolean> {
    try {
      const loc = this.page.getByText(text, { exact: false }).first();
      if ((await loc.count()) === 0) return false;
      await loc.click({ timeout: 5000 });
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async capture(screenshotPath?: string): Promise<CapturedScreen> {
    if (screenshotPath) {
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
    }
    const rawTexts = await this.page.locator('body').allInnerTexts();
    const texts = rawTexts
      .flatMap((t) => t.split('\n'))
      .map((s) => s.trim())
      .filter(Boolean);
    const elements = await this.page
      .locator('button, a, input, [role=button]')
      .evaluateAll((els) =>
        els
          .map((e) => (e.textContent || e.getAttribute('name') || e.getAttribute('aria-label') || e.tagName).trim())
          .filter(Boolean),
      );
    return { texts, elements, screenshotPath };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export function createPlaywrightDriver(opts: { headless?: boolean } = {}): BrowserDriver {
  return {
    async open(): Promise<BrowserSession> {
      const browser = await chromium.launch({ headless: opts.headless ?? true });
      const page = await browser.newPage();
      return new PlaywrightSession(browser, page);
    },
  };
}
```

- [ ] **Step 7: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test browser && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: fake 2 tests PASS, tsc 0 errors(playwright 타입 포함).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/browser apps/server/package.json pnpm-lock.yaml
git commit -m "$(printf '✨ ringq: BrowserSession 포트(+fake +Playwright 구현) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `runner` — 캡처 오케스트레이션

**Files:**
- Create: `apps/server/src/runner/runner.ts`
- Test: `apps/server/src/runner/runner.test.ts`

**Interfaces:**
- Consumes: `Store`(listCases), `BrowserDriver`(Task 2), `@ringq/shared`(`RunCapture`).
- Produces:
  - `createRunner(deps: { store: Store; driver: BrowserDriver }, opts?: { artifactDir?: string; creds?: { username?: string; password?: string } }): Runner`
  - `Runner.run(runId: string): Promise<RunCapture[]>`
  - 동작:
    1. `store.getRun(runId)` 없으면 throw. `store.listCases(runId)`에서 `status==='confirmed'`인 케이스만 대상.
    2. `driver.open()` → session.
    3. `session.goto(run.siteUrl)`.
    4. creds.username && creds.password 둘 다 있으면 `session.tryLogin` 호출 → 결과가 `'failed'`면 throw `Error('로그인 실패')`(Run 실패 처리). `'no-form'`/`'logged-in'`은 계속.
    5. 각 confirmed 케이스에 대해(에러 격리 — try/catch로 케이스별 `error` 기록):
       - `ui`: `routePath`가 있으면 `session.goto(run.siteUrl + routePath)`. `screenshotPath = <artifactDir>/<runId>/<caseId>.png` (artifactDir 기본 `data/runs`). 디렉토리 생성 후 `session.capture(screenshotPath)`. RunCapture 푸시(`type:'ui'`, url, texts, elements, screenshotPath).
       - `flow`: 각 step에 대해 `session.clickByText(step.target)` 순차 실행; 모두 true면 `flowOk=true`, 하나라도 false면 `flowOk=false`. 그 후 `session.capture(screenshotPath)`. RunCapture 푸시(`type:'flow'`, flowOk).
       - 케이스 처리 중 throw 시 그 케이스에 `error` 채운 RunCapture 푸시하고 계속.
    6. `session.close()`는 finally에서 호출(에러 나도 닫음).
    7. 캡처 배열 반환.

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/server/src/runner/runner.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.js';
import { createRunner } from './runner.js';
import { createFakeDriver } from '../browser/fake.js';
import type { TestCase } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://example.com' };

function seedConfirmed(): { store: ReturnType<typeof createStore>; runId: string } {
  const store = createStore(':memory:');
  const run = store.createRun(input);
  const cases: TestCase[] = [
    { id: 'tc_ui', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: '로그인 UI', figmaNodeId: '1:2' },
    { id: 'tc_flow', runId: run.id, type: 'flow', source: 'figma', status: 'confirmed', title: '플로우', steps: [{ action: 'click', target: '로그인 버튼' }] },
    { id: 'tc_draft', runId: run.id, type: 'ui', source: 'figma', status: 'draft', title: '미확정' },
  ];
  store.saveCases(run.id, cases);
  return { store, runId: run.id };
}

describe('runner', () => {
  it('confirmed 케이스만 캡처한다 (draft 제외)', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ screen: { texts: ['환영'], elements: ['button'] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    const caps = await runner.run(runId);

    expect(caps.map((c) => c.caseId).sort()).toEqual(['tc_flow', 'tc_ui']);
    const ui = caps.find((c) => c.caseId === 'tc_ui')!;
    expect(ui.texts).toContain('환영');
    expect(ui.screenshotPath).toContain(runId);
  });

  it('flow step click 실패 시 flowOk=false', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ clicks: { '로그인 버튼': false }, screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    const caps = await runner.run(runId);
    expect(caps.find((c) => c.caseId === 'tc_flow')!.flowOk).toBe(false);
  });

  it('creds가 있고 로그인 실패면 throw한다', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ login: 'failed' });
    const runner = createRunner({ store, driver }, { artifactDir: dir, creds: { username: 'u', password: 'p' } });

    await expect(runner.run(runId)).rejects.toThrow(/로그인 실패/);
  });

  it('creds 없으면 로그인 시도하지 않는다', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ login: 'failed', screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir }); // creds 없음

    // 로그인 안 하므로 'failed'여도 throw 안 함
    const caps = await runner.run(runId);
    expect(caps.length).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test runner`
Expected: FAIL — `./runner.js` 없음.

- [ ] **Step 3: 구현** — `apps/server/src/runner/runner.ts`

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RunCapture, TestCase } from '@ringq/shared';
import type { Store } from '../store.js';
import type { BrowserDriver, BrowserSession } from '../browser/session.js';

export interface Runner {
  run(runId: string): Promise<RunCapture[]>;
}

interface RunnerOpts {
  artifactDir?: string;
  creds?: { username?: string; password?: string };
}

export function createRunner(deps: { store: Store; driver: BrowserDriver }, opts: RunnerOpts = {}): Runner {
  const { store, driver } = deps;
  const artifactDir = opts.artifactDir ?? 'data/runs';

  async function captureCase(
    session: BrowserSession,
    run: { siteUrl: string },
    runId: string,
    tc: TestCase,
  ): Promise<RunCapture> {
    const shotDir = join(artifactDir, runId);
    mkdirSync(shotDir, { recursive: true });
    const screenshotPath = join(shotDir, `${tc.id}.png`);

    if (tc.type === 'ui') {
      const url = tc.routePath ? run.siteUrl + tc.routePath : run.siteUrl;
      if (tc.routePath) await session.goto(url);
      const screen = await session.capture(screenshotPath);
      return { caseId: tc.id, runId, type: 'ui', url, texts: screen.texts, elements: screen.elements, screenshotPath };
    }

    // flow
    let flowOk = true;
    for (const step of tc.steps ?? []) {
      const ok = await session.clickByText(step.target);
      if (!ok) flowOk = false;
    }
    const screen = await session.capture(screenshotPath);
    return {
      caseId: tc.id,
      runId,
      type: 'flow',
      url: run.siteUrl,
      texts: screen.texts,
      elements: screen.elements,
      screenshotPath,
      flowOk,
    };
  }

  return {
    async run(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      const cases = store.listCases(runId).filter((c) => c.status === 'confirmed');

      const session = await driver.open();
      const captures: RunCapture[] = [];
      try {
        await session.goto(run.siteUrl);

        if (opts.creds?.username && opts.creds?.password) {
          const result = await session.tryLogin({ username: opts.creds.username, password: opts.creds.password });
          if (result === 'failed') throw new Error('로그인 실패: 자격증명 또는 폼 탐지 확인 필요');
        }

        for (const tc of cases) {
          try {
            captures.push(await captureCase(session, run, runId, tc));
          } catch (err) {
            captures.push({
              caseId: tc.id,
              runId,
              type: tc.type,
              url: run.siteUrl,
              texts: [],
              elements: [],
              error: err instanceof Error ? err.message : '캡처 실패',
            });
          }
        }
      } finally {
        await session.close();
      }
      return captures;
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test runner && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 4 tests PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/runner
git commit -m "$(printf '✨ ringq: Playwright runner(로그인 선택·케이스별 캡처·에러 격리) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: `store` — captures 영속화

**Files:**
- Modify: `apps/server/src/store.ts`
- Test: `apps/server/src/store.test.ts` (append)

**Interfaces:**
- Consumes: `@ringq/shared`의 `RunCapture`.
- Produces (Store 인터페이스에 추가):
  - `saveCaptures(runId: string, captures: RunCapture[]): void` — 해당 run의 기존 캡처 삭제 후 새로 저장(트랜잭션).
  - `listCaptures(runId: string): RunCapture[]` — 삽입 순.
  - 새 테이블 `captures(seq, id AUTO, run_id, case_id, type, url, texts TEXT, elements TEXT, screenshot_path, flow_ok INTEGER, error)`; texts/elements는 JSON. flow_ok는 0/1/null.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/store.test.ts` 끝에 append

```ts
import type { RunCapture } from '@ringq/shared';

const cap1: RunCapture = {
  caseId: 'tc_1', runId: 'r1', type: 'ui', url: 'https://e.com',
  texts: ['로그인'], elements: ['button'], screenshotPath: 'data/runs/r1/tc_1.png',
};
const cap2: RunCapture = {
  caseId: 'tc_2', runId: 'r1', type: 'flow', url: 'https://e.com',
  texts: [], elements: [], flowOk: false, error: 'click 실패',
};

describe('store captures', () => {
  it('saveCaptures/listCaptures 라운드트립', () => {
    const store = createStore(':memory:');
    store.saveCaptures('r1', [cap1, cap2]);
    const got = store.listCaptures('r1');
    expect(got).toHaveLength(2);
    expect(got[0].texts).toEqual(['로그인']);
    expect(got[0].screenshotPath).toBe('data/runs/r1/tc_1.png');
    expect(got[1].flowOk).toBe(false);
    expect(got[1].error).toBe('click 실패');
  });

  it('saveCaptures는 기존 캡처를 교체한다', () => {
    const store = createStore(':memory:');
    store.saveCaptures('r1', [cap1, cap2]);
    store.saveCaptures('r1', [cap1]);
    expect(store.listCaptures('r1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test store`
Expected: FAIL — saveCaptures 없음.

- [ ] **Step 3: 구현** — `apps/server/src/store.ts`

import에 `RunCapture` 추가:

```ts
import type { ProjectInput, Run, RunPhase, RunStatus, TestCase, RunCapture } from '@ringq/shared';
```

`Store` 인터페이스에 추가(`confirmCases` 뒤):

```ts
  saveCaptures(runId: string, captures: RunCapture[]): void;
  listCaptures(runId: string): RunCapture[];
```

test_cases 테이블 생성 `db.exec(...)` 뒤에 captures 테이블 추가:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      texts TEXT NOT NULL,
      elements TEXT NOT NULL,
      screenshot_path TEXT,
      flow_ok INTEGER,
      error TEXT
    );
  `);
```

`rowToCase` 옆에 캡처 변환 헬퍼 추가:

```ts
interface CaptureRow {
  run_id: string;
  case_id: string;
  type: string;
  url: string;
  texts: string;
  elements: string;
  screenshot_path: string | null;
  flow_ok: number | null;
  error: string | null;
}

function rowToCapture(row: CaptureRow): RunCapture {
  return {
    caseId: row.case_id,
    runId: row.run_id,
    type: row.type as RunCapture['type'],
    url: row.url,
    texts: JSON.parse(row.texts),
    elements: JSON.parse(row.elements),
    screenshotPath: row.screenshot_path ?? undefined,
    flowOk: row.flow_ok === null ? undefined : row.flow_ok === 1,
    error: row.error ?? undefined,
  };
}
```

`return { ... }`의 `confirmCases` 뒤에 메서드 추가:

```ts
    saveCaptures(runId, captures) {
      const del = db.prepare(`DELETE FROM captures WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO captures (run_id, case_id, type, url, texts, elements, screenshot_path, flow_ok, error)
         VALUES (@run_id, @case_id, @type, @url, @texts, @elements, @screenshot_path, @flow_ok, @error)`,
      );
      const tx = db.transaction((rows: RunCapture[]) => {
        del.run(runId);
        for (const c of rows) {
          ins.run({
            run_id: runId,
            case_id: c.caseId,
            type: c.type,
            url: c.url,
            texts: JSON.stringify(c.texts),
            elements: JSON.stringify(c.elements),
            screenshot_path: c.screenshotPath ?? null,
            flow_ok: c.flowOk === undefined ? null : c.flowOk ? 1 : 0,
            error: c.error ?? null,
          });
        }
      });
      tx(captures);
    },
    listCaptures(runId) {
      const rows = db.prepare(`SELECT * FROM captures WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CaptureRow[];
      return rows.map(rowToCapture);
    },
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test store && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 기존 11 + 신규 2 = 13 PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/store.ts apps/server/src/store.test.ts
git commit -m "$(printf '✨ ringq: store에 captures 영속화(save/list) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: 파이프라인 — 실제 running 단계 (runner 주입)

**Files:**
- Modify: `apps/server/src/pipeline.ts`
- Modify: `apps/server/src/pipeline.test.ts`
- Modify: `apps/server/src/app.test.ts` (setup에 runner 주입)
- Modify: `apps/server/src/index.ts` (createPipeline에 runner 전달 — Task 8에서 실제 driver로 완성하나, 여기선 컴파일 유지 위해 최소 연결)

**Interfaces:**
- Consumes: `Runner`(Task 3), 기존 pipeline deps.
- Produces:
  - `createPipeline`의 deps에 `runner: Runner` 추가: `createPipeline(deps: { store; figma; generator; runner }, opts)`.
  - `resume`의 `running` 단계를 실제로: phase=`running` emit → `const captures = await runner.run(runId)` → `store.saveCaptures(runId, captures)` → emit(메시지에 캡처 수). 그 뒤 `comparing`/`reporting`은 스텁 유지 → `done`.
  - 에러 처리(failed + rethrow)는 기존 유지(runner throw 시 Run failed).

- [ ] **Step 1: pipeline.test.ts 갱신** — resume 테스트가 fake runner를 주입하도록 수정, running 캡처 저장 검증 추가

`pipeline.test.ts` 상단 import에 추가:

```ts
import { createRunner } from './runner/runner.js';
import { createFakeDriver } from './browser/fake.js';
```

`makeDeps()`를 다음으로 교체:

```ts
function makeDeps() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  const driver = createFakeDriver({ screen: { texts: ['홈'], elements: [] } });
  const runner = createRunner({ store, driver }, { artifactDir: 'data/test-runs' });
  return { store, generator, figma: fakeFigma, runner };
}
```

resume 테스트를 다음으로 교체(케이스가 있어야 캡처가 생기므로 confirmed 케이스 seed):

```ts
describe('pipeline resume 단계', () => {
  it('cases-confirmed면 runner로 캡처 저장 후 done으로 끝낸다', async () => {
    const deps = makeDeps();
    const run = deps.store.createRun(input);
    deps.store.saveCases(run.id, [
      { id: 'tc_1', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: 'UI', figmaNodeId: '1:2' },
    ]);
    deps.store.updateRun(run.id, { phase: 'cases-confirmed' });

    await createPipeline(deps, { delayMs: 0 })(run.id);

    expect(deps.store.getRun(run.id)!.phase).toBe('done');
    expect(deps.store.listCaptures(run.id).length).toBe(1);
  });
});
```

(generate 테스트와 error 테스트의 `makeDeps()` 호출은 그대로 둔다 — runner가 deps에 포함됨.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test pipeline`
Expected: FAIL — createPipeline가 runner를 모름 / listCaptures 0.

- [ ] **Step 3: pipeline.ts 구현** — `apps/server/src/pipeline.ts`

import 추가:

```ts
import type { Runner } from './runner/runner.js';
```

`PipelineDeps`에 추가:

```ts
interface PipelineDeps {
  store: Store;
  figma: FigmaClient;
  generator: CaseGenerator;
  runner: Runner;
}
```

`const { store, figma, generator } = deps;`를 `const { store, figma, generator, runner } = deps;`로.

`resume`의 RESUME_STEPS 루프를 제거하고 다음으로 교체:

```ts
  async function resume(runId: string): Promise<void> {
    // running (실제 Playwright 캡처)
    store.updateRun(runId, { phase: 'running' });
    emitProgress({ runId, phase: 'running', message: 'Playwright로 사이트 캡처 중...', at: now() });
    const captures = await runner.run(runId);
    store.saveCaptures(runId, captures);
    emitProgress({ runId, phase: 'running', message: `${captures.length}개 화면 캡처 완료`, at: now() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    // comparing / reporting (스텁 — Plan 4~5)
    for (const step of STUB_STEPS) {
      store.updateRun(runId, { phase: step.phase });
      emitProgress({ runId, phase: step.phase, message: step.message, at: now() });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    store.updateRun(runId, { phase: 'done', status: 'done' });
    emitProgress({ runId, phase: 'done', message: 'QA 완료', at: now() });
  }
```

`RESUME_STEPS` 상수를 `STUB_STEPS`로 이름 바꾸고 running 제거:

```ts
const STUB_STEPS: { phase: RunPhase; message: string }[] = [
  { phase: 'comparing', message: 'Figma ↔ 실제 화면 비교 중...' },
  { phase: 'reporting', message: '리포트 작성 중...' },
];
```

- [ ] **Step 4: app.test.ts setup에 runner 주입** — `apps/server/src/app.test.ts`

import 추가:

```ts
import { createRunner } from './runner/runner.js';
import { createFakeDriver } from './browser/fake.js';
```

`setup()`의 queue 생성부를 다음으로 교체:

```ts
function setup() {
  const store = createStore(':memory:');
  const generator = createCaseGenerator(createFakeLLM([]));
  const driver = createFakeDriver({ screen: { texts: [], elements: [] } });
  const runner = createRunner({ store, driver }, { artifactDir: 'data/test-runs' });
  const queue = createQueue(createPipeline({ store, figma: fakeFigma, generator, runner }, { delayMs: 0 }));
  const app = buildApp({ store, queue });
  return { store, queue, app };
}
```

- [ ] **Step 5: index.ts 연결** — `apps/server/src/index.ts`

`createPipeline({ store, figma, generator }, ...)` 호출에 runner를 추가해야 컴파일된다. Task 8에서 실제 Playwright driver로 완성하지만, 여기서 최소 연결:

import 추가:

```ts
import { createRunner } from './runner/runner.js';
import { createPlaywrightDriver } from './browser/playwright.js';
```

generator 생성 뒤, queue 생성 전에:

```ts
const driver = createPlaywrightDriver({ headless: true });
const runner = createRunner(
  { store, driver },
  { creds: { username: process.env.SITE_USERNAME, password: process.env.SITE_PASSWORD } },
);
```

queue 생성을 `createQueue(createPipeline({ store, figma, generator, runner }, { delayMs: 300 }))`로.

- [ ] **Step 6: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test pipeline app && pnpm --filter @ringq/server test && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: pipeline 3 + app 12 PASS, 전체 서버 스위트 PASS, tsc 0 errors.

> 주의: `data/test-runs` 디렉토리가 테스트 중 생성될 수 있다. `.gitignore`의 `data/`가 이미 무시하므로 커밋되지 않음 — 확인만.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/pipeline.test.ts apps/server/src/app.test.ts apps/server/src/index.ts
git commit -m "$(printf '♻️ ringq: 파이프라인 running 단계를 실제 Playwright runner로 교체\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: API — 캡처 조회 + 스크린샷 서빙

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/app.test.ts` (append)

**Interfaces:**
- Consumes: `Store`(listCaptures), node `fs`.
- Produces:
  - `GET /api/runs/:id/captures` → `store.listCaptures(id)` (run 없으면 404).
  - `GET /api/runs/:id/captures/:caseId/screenshot` → 해당 캡처의 `screenshotPath` 파일을 읽어 `image/png`로 응답. 캡처 없거나 screenshotPath 없거나 파일 없으면 404.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/server/src/app.test.ts` 끝에 append

```ts
import type { RunCapture } from '@ringq/shared';

describe('GET /api/runs/:id/captures', () => {
  it('run의 캡처를 반환한다', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    const caps: RunCapture[] = [
      { caseId: 'tc_1', runId: run.id, type: 'ui', url: 'https://e.com', texts: ['x'], elements: [] },
    ];
    store.saveCaptures(run.id, caps);
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/captures` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('없는 run이면 404', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/runs/nope/captures' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET screenshot', () => {
  it('screenshotPath 없으면 404', async () => {
    const { app, store } = setup();
    const run = store.createRun({ figmaLinks: ['https://www.figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://e.com' });
    store.saveCaptures(run.id, [{ caseId: 'tc_1', runId: run.id, type: 'ui', url: 'https://e.com', texts: [], elements: [] }]);
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/captures/tc_1/screenshot` });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/server test app`
Expected: FAIL — captures 라우트 없음.

- [ ] **Step 3: 구현** — `apps/server/src/app.ts`

상단 import에 추가:

```ts
import { existsSync, readFileSync } from 'node:fs';
```

confirm 라우트 뒤(SSE 라우트 앞)에 추가:

```ts
  app.get<{ Params: { id: string } }>('/api/runs/:id/captures', async (req, reply) => {
    if (!store.getRun(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return store.listCaptures(req.params.id);
  });

  app.get<{ Params: { id: string; caseId: string } }>(
    '/api/runs/:id/captures/:caseId/screenshot',
    async (req, reply) => {
      const cap = store.listCaptures(req.params.id).find((c) => c.caseId === req.params.caseId);
      if (!cap?.screenshotPath || !existsSync(cap.screenshotPath)) {
        return reply.code(404).send({ error: 'screenshot not found' });
      }
      return reply.type('image/png').send(readFileSync(cap.screenshotPath));
    },
  );
```

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `pnpm --filter @ringq/server test app && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json`
Expected: 기존 12 + 신규 3 = 15 PASS, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "$(printf '✨ ringq: 캡처 조회 + 스크린샷 서빙 API 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: web — 캡처 결과 뷰

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/Captures.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/api.test.ts` (append)

**Interfaces:**
- Consumes: 서버 captures API, `@ringq/shared`(`RunCapture`).
- Produces:
  - `api.ts`에 `fetchCaptures(runId: string): Promise<RunCapture[]>` (GET captures, `!res.ok` throw).
  - `Captures.tsx`: `{ runId: string }`. 마운트 시 `fetchCaptures` → 캡처 목록 렌더(케이스별: type, url, flowOk/error, 스크린샷 `<img src="/api/runs/<runId>/captures/<caseId>/screenshot">`, 추출 텍스트 일부). 폴링 없이 1회 로드 + 새로고침 버튼.
  - `App.tsx`: SSE progress phase가 `done`이면 `<Captures runId={run.id} />`를 렌더.

- [ ] **Step 1: 실패하는 테스트 추가** — `apps/web/src/api.test.ts` 끝에 append

```ts
import { fetchCaptures } from './api.js';

describe('fetchCaptures', () => {
  it('GET /api/runs/:id/captures 결과를 반환한다', async () => {
    const caps = [{ caseId: 'tc_1', type: 'ui', url: 'https://e.com', texts: [], elements: [] }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => caps });
    vi.stubGlobal('fetch', fetchMock);
    const got = await fetchCaptures('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/captures');
    expect(got).toHaveLength(1);
  });

  it('서버 실패 시 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    await expect(fetchCaptures('run_1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @ringq/web test`
Expected: FAIL — `fetchCaptures` 없음.

- [ ] **Step 3: api.ts에 추가** — `apps/web/src/api.ts` 끝에

```ts
import type { RunCapture } from '@ringq/shared';

export async function fetchCaptures(runId: string): Promise<RunCapture[]> {
  return jsonOrThrow(await fetch(`/api/runs/${runId}/captures`), 'fetchCaptures');
}
```

> `jsonOrThrow`와 `RunCapture` import가 이미 있는지 확인하고 중복 import는 합칠 것.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @ringq/web test`
Expected: 기존 5 + 신규 2 = 7 PASS.

- [ ] **Step 5: Captures 컴포넌트 작성** — `apps/web/src/Captures.tsx`

```tsx
import { useEffect, useState } from 'react';
import type { RunCapture } from '@ringq/shared';
import { fetchCaptures } from './api.js';

export function Captures({ runId }: { runId: string }) {
  const [caps, setCaps] = useState<RunCapture[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchCaptures(runId).then(setCaps).catch((e) => setError(String(e)));
  }
  useEffect(load, [runId]);

  return (
    <section style={{ marginTop: 24 }}>
      <h2>캡처 결과 ({caps.length}) <button onClick={load}>새로고침</button></h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'grid', gap: 16 }}>
        {caps.map((c) => (
          <article key={c.caseId} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
            <div>
              <strong>[{c.type}]</strong> {c.url}
              {c.type === 'flow' && <span> · 플로우 {c.flowOk ? '성공' : '실패'}</span>}
              {c.error && <span style={{ color: 'crimson' }}> · {c.error}</span>}
            </div>
            {c.screenshotPath && (
              <img
                src={`/api/runs/${runId}/captures/${c.caseId}/screenshot`}
                alt={c.caseId}
                style={{ maxWidth: '100%', marginTop: 8, border: '1px solid #eee' }}
              />
            )}
            {c.texts.length > 0 && (
              <p style={{ fontSize: 12, color: '#666' }}>추출 텍스트: {c.texts.slice(0, 8).join(' · ')}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: App.tsx에 done 분기 연결** — `apps/web/src/App.tsx`

import 추가:

```tsx
import { Captures } from './Captures.js';
```

상태 추가:

```tsx
  const [done, setDone] = useState(false);
```

progress 리스너에서 done 감지(기존 done/failed close 로직 옆):

```tsx
        if (ev.phase === 'done') setDone(true);
```

`onRun` 초기화부에 `setDone(false);` 추가(setAwaitingReview(false) 옆).

CaseReview 렌더 블록 뒤에 추가:

```tsx
      {run && done && <Captures runId={run.id} />}
```

- [ ] **Step 7: 빌드 검증**

Run: `pnpm --filter @ringq/web test && pnpm --filter @ringq/web build`
Expected: 7 tests PASS, 빌드 성공.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "$(printf '✨ ringq: web 캡처 결과 뷰(스크린샷·플로우 결과·추출 텍스트) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: 런타임 마무리 + README + e2e 검증

**Files:**
- Modify: `README.md`
- (index.ts는 Task 5에서 이미 Playwright driver로 연결됨 — 변경 없으면 확인만)

**Interfaces:**
- Consumes: 전체.
- Produces: Playwright 브라우저 설치 안내 + Plan 3 상태 README.

- [ ] **Step 1: Playwright 브라우저 설치(런타임 의존)**

Run: `pnpm --filter @ringq/server exec playwright install chromium`
Expected: chromium 바이너리 설치 완료. (테스트는 fake라 불필요하지만 실제 실행엔 필요.)

- [ ] **Step 2: README 업데이트** — "현재 상태" 문단 교체

```markdown
> **현재 상태(Plan 3):** Phase 1(Figma→케이스→검수/확정) + Phase 2(확정 후 실제 Playwright 실행)이 동작합니다. 확정하면 runner가 사이트에 접속(`SITE_USERNAME`/`SITE_PASSWORD`가 있으면 휴리스틱 로그인, 없으면 스킵)해 케이스별로 화면을 캡처(스크린샷 + DOM 텍스트/요소)하고, 대시보드의 "캡처 결과"에서 스크린샷과 추출 내용을 봅니다. 비교(comparing)/리포트(reporting)는 아직 스텁이며 Plan 4~5에서 구현됩니다.
>
> 최초 1회 브라우저 설치 필요: `pnpm --filter @ringq/server exec playwright install chromium`
```

- [ ] **Step 3: 전체 테스트 + 타입체크 + 빌드**

Run: `pnpm -r test && pnpm --filter @ringq/server exec tsc --noEmit -p tsconfig.json && pnpm --filter @ringq/web build`
Expected: 전부 PASS/clean. (shared 11, server: store 13/figma 5/llm 1/generator 4/queue 2/pipeline 3/app 15/browser 2/runner 4, web 7)

- [ ] **Step 4: e2e 검증 (fake 경로)**

awaiting-review→confirm→running(runner)→done + 캡처 저장 경로는 pipeline.test(resume) + app.test(confirm/captures)가 커버한다. 근거로 다음 출력을 리포트에 첨부:

Run: `pnpm --filter @ringq/server test pipeline app`
Expected: 관련 테스트 전부 PASS(running 단계가 fake driver로 캡처 저장 → done).

> 실제 라이브 e2e(진짜 사이트 + 브라우저)는 키/계정/네트워크가 필요하므로 사용자 수동 검증 항목으로 남긴다(README에 실행법).

- [ ] **Step 5: data/ 미커밋 확인**

Run: `git status --porcelain | grep -E '(data/|\.png)' || echo "clean"`
Expected: `clean` (스크린샷/DB 미추적).

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "$(printf '📑 ringq: Plan 3(Playwright runner) README + 실행 안내 업데이트\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review 결과

**Spec coverage:**
- runner(Playwright 로그인·이동·스크린샷·DOM 추출) → Task 2(포트) + Task 3(오케스트레이션) ✅
- 단일 페이지 모드(결정 A) + 선택적 routePath → Task 1 + Task 3 ✅
- 선택적 휴리스틱 로그인(결정 C) → Task 2(tryLogin) + Task 3(creds 분기) ✅
- 캡처 영속(아티팩트 디스크) → Task 4(store) + Task 3(스크린샷 파일) ✅
- pause/resume의 running 실연결 → Task 5 ✅
- 결과 노출(API+web) → Task 6 + Task 7 ✅
- 외부 의존 주입/테스트 네트워크 차단(fake driver) → Task 2/3/5 ✅
- 케이스 단위 에러 격리 + 로그인 실패 시 Run 실패 → Task 3 ✅
- **Plan 3 범위 밖(의도된 스텁)**: comparator(comparing) / report(reporting) / code-suggester → Plan 4~5.

**Placeholder scan:** 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency:** `BrowserDriver`/`BrowserSession`/`CapturedScreen`/`LoginResult`(Task 2) → runner/playwright/fake 동일 import. `RunCapture`(Task 1, shared) → runner/store/api/web 동일 정의 import. `Runner`(Task 3) → pipeline/index 동일. `createPipeline(deps{store,figma,generator,runner})` 시그니처가 pipeline/app.test/index에서 일치. store 신규 메서드(saveCaptures/listCaptures)가 runner-pipeline/api에서 동일 사용.

**태스크 경계 주의:** Task 5가 `createPipeline` 시그니처에 runner를 추가하므로 app.test.ts setup·index.ts를 같은 커밋에서 갱신(Step 4·5에 포함) — Plan 2 Task 6과 동일 패턴으로 스위트 green 유지.
