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
}

export interface EntryStep {
  verb: 'click' | 'fill' | 'select' | 'check' | 'next';
  target: string;
  value?: string;
}

/**
 * 진입 단계 문자열을 구조화 스텝으로 파싱.
 * - "click:상품추가" / 접두사 없는 텍스트 → click
 * - "fill:연식=2020" → fill(연식, 2020)
 * - "select:제조사명=현대" → select(제조사명, 현대)
 * - "check:firstRow" / "check:동의" → check
 * - "next" / "다음" → 다음 버튼 클릭
 */
export function parseEntryStep(raw: string): EntryStep {
  const s = raw.trim();
  const m = s.match(/^(click|fill|select|check)\s*:\s*(.+)$/i);
  if (m) {
    const verb = m[1].toLowerCase() as 'click' | 'fill' | 'select' | 'check';
    const rest = m[2].trim();
    if (verb === 'fill' || verb === 'select') {
      const eq = rest.indexOf('=');
      const target = eq >= 0 ? rest.slice(0, eq).trim() : rest;
      const value = eq >= 0 ? rest.slice(eq + 1).trim() : '';
      return { verb, target, value };
    }
    return { verb, target: rest };
  }
  if (s === 'next' || s === '다음') return { verb: 'next', target: '다음' };
  return { verb: 'click', target: s };
}

async function runEntrySteps(session: BrowserSession, steps: string[]): Promise<void> {
  for (const raw of steps) {
    const st = parseEntryStep(raw);
    if (st.verb === 'fill') await session.fill(st.target, st.value ?? '');
    else if (st.verb === 'select') await session.selectOption(st.target, st.value ?? '');
    else if (st.verb === 'check') await session.check(st.target);
    else if (st.verb === 'next') await session.clickByText('다음');
    else await session.clickByText(st.target);
  }
}

export function createRunner(deps: { store: Store; driver: BrowserDriver }, opts: RunnerOpts = {}): Runner {
  const { store, driver } = deps;
  const artifactDir = opts.artifactDir ?? 'data/runs';

  async function captureCase(
    session: BrowserSession,
    run: { siteUrl: string; entrySteps?: string[] },
    runId: string,
    tc: TestCase,
  ): Promise<RunCapture> {
    const shotDir = join(artifactDir, runId);
    mkdirSync(shotDir, { recursive: true });
    const screenshotPath = join(shotDir, `${tc.id}.png`);

    if (tc.type === 'ui') {
      const url = tc.routePath ? run.siteUrl + tc.routePath : run.siteUrl;
      // UI 케이스는 항상 대상 URL로 이동한 뒤 캡처한다. 로그인 리다이렉트나 직전
      // 케이스의 화면 이동으로 현재 페이지가 의도와 달라지는 것을 방지.
      await session.goto(url);
      // 진입 단계: 캡처 전에 구조화 스텝(click/fill/select/check/next)을 순서대로 실행.
      await runEntrySteps(session, run.entrySteps ?? []);
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

        const creds = store.getCredentials(runId);
        if (creds?.username && creds?.password) {
          const result = await session.tryLogin({ username: creds.username, password: creds.password });
          if (result === 'failed') throw new Error('로그인 실패: 자격증명 또는 폼 탐지 확인 필요');
          if (result === 'logged-in') {
            // 로그인 과정에서 앱 기본 페이지로 리다이렉트되므로, 사용자가 제공한 원래
            // siteUrl로 다시 이동해 의도한 화면에서 테스트한다.
            await session.goto(run.siteUrl);
          }
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
