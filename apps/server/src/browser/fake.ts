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
