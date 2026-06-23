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
      // Decision-C: if no fillable username field exists, fill() throws and we
      // return 'failed' (caught below). Surfacing the failure is intentional —
      // silently skipping a partially-matched login form would hide real errors.
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
      try {
        const page = await browser.newPage();
        return new PlaywrightSession(browser, page);
      } catch (err) {
        await browser.close().catch(() => {});
        throw err;
      }
    },
  };
}
