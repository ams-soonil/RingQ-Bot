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

export interface FakeDriver extends BrowserDriver {
  /** 지금까지 open()으로 만들어진 세션들(테스트에서 호출 시퀀스 검증용). */
  sessions: FakeSession[];
}

export function createFakeDriver(script: FakeScript = {}): FakeDriver {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    async open(): Promise<FakeSession> {
      const calls: string[] = [];
      const session: FakeSession = {
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
        async fill(label, value) {
          calls.push(`fill:${label}=${value}`);
          return true;
        },
        async selectOption(label, value) {
          calls.push(`select:${label}=${value}`);
          return true;
        },
        async check(target) {
          calls.push(`check:${target}`);
          return true;
        },
        async capture(screenshotPath) {
          calls.push(`capture:${screenshotPath ?? ''}`);
          return { ...(script.screen ?? { texts: [], elements: [] }), screenshotPath };
        },
        async close() {
          calls.push('close');
        },
      };
      sessions.push(session);
      return session;
    },
  };
}
