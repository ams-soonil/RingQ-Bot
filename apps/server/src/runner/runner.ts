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
      // 진입 단계: 캡처 전에 지정된 버튼들을 순서대로 클릭(예: 상품추가 → 팝업 진입).
      for (const step of run.entrySteps ?? []) {
        await session.clickByText(step);
      }
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
