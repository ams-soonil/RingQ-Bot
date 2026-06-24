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
    const pw = this.page.locator('input[type=password]').first();
    // SPA는 domcontentloaded 이후에 로그인 폼을 렌더링하므로, 즉시 count()로 판단하면
    // 폼을 놓친다(no-form 오판). 비밀번호 필드가 나타날 때까지 조건 기반으로 대기한다.
    try {
      await pw.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      return 'no-form'; // 폼이 끝내 안 뜸 → 이미 로그인됐거나 로그인 폼 없음
    }
    try {
      const user = this.page
        .locator(
          'input[type=email], input[type=text], input[name*=user i], input[name*=email i], input[name*=id i], input[name*=login i]',
        )
        .first();
      // Decision-C: if no fillable username field exists, fill() throws and we
      // return 'failed' (caught below). Surfacing the failure is intentional —
      // silently skipping a partially-matched login form would hide real errors.
      await user.fill(creds.username);
      await pw.fill(creds.password);
      const btn = this.page
        .locator(
          'button[type=submit], input[type=submit], button:has-text("로그인"), button:has-text("로그인하기"), button:has-text("Login"), button:has-text("Sign in")',
        )
        .first();
      if ((await btn.count()) > 0) await btn.click();
      else await pw.press('Enter');
      // 로그인 성공 시 SPA 전이로 비밀번호 필드가 사라진다. 사라질 때까지 대기(조건 기반).
      // 실패(잘못된 자격증명)면 폼이 남아 타임아웃 → 'failed'로 판정.
      await this.page
        .locator('input[type=password]')
        .first()
        .waitFor({ state: 'detached', timeout: 15000 })
        .catch(() => {});
      return (await this.page.locator('input[type=password]').count()) === 0 ? 'logged-in' : 'failed';
    } catch {
      return 'failed';
    }
  }

  async clickByText(text: string): Promise<boolean> {
    // SPA 렌더 대기: 네비게이션 직후 버튼이 아직 없을 수 있어, 본문/버튼이 뜰 때까지 대기.
    await this.page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await this.page
      .locator('button, [role=button]')
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .catch(() => {});

    // 1) 직접 매칭: 입력 텍스트를 "포함하는" 클릭 가능한 요소.
    if (await this.clickLocator(this.page.getByRole('button', { name: text }).first())) return true;
    if (await this.clickLocator(this.page.getByText(text, { exact: false }).first())) return true;

    // 2) 자연어 지시 대응: 입력이 문장이면 그대로는 안 맞는다. 페이지의 클릭 가능한
    //    요소 라벨 중 "그 라벨이 입력 문장 안에 포함되는" 것을 찾아 클릭(공백 무시, 가장 긴 라벨 우선).
    //    예: "...상품 추가 버튼을 클릭..." → 라벨 "상품 추가" 버튼을 매칭.
    try {
      const labels: string[] = await this.page
        // 네비 링크(a)는 제외하고 "버튼"만 후보로(자연어 지시는 보통 버튼 클릭).
        .locator('button, [role=button], input[type=submit], input[type=button]')
        .evaluateAll((els) =>
          els
            .map((e) => (e.textContent || (e as HTMLInputElement).value || e.getAttribute('aria-label') || '').trim())
            .filter(Boolean),
        );
      const norm = (s: string) => s.replace(/\s+/g, '');
      const t = norm(text);
      const best = labels
        .filter((l) => l.length >= 2 && t.includes(norm(l)))
        .sort((a, b) => b.length - a.length)[0];
      if (best) {
        if (await this.clickLocator(this.page.getByRole('button', { name: best }).first())) return true;
        if (await this.clickLocator(this.page.getByText(best, { exact: false }).first())) return true;
      }
    } catch {
      /* fallthrough */
    }
    return false;
  }

  private async clickLocator(loc: import('playwright').Locator): Promise<boolean> {
    try {
      if ((await loc.count()) === 0) return false;
      await loc.click({ timeout: 5000 });
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async capture(screenshotPath?: string): Promise<CapturedScreen> {
    // SPA는 네비게이션 직후 본문이 비어 있다(렌더 전). 본문 텍스트가 생기거나
    // 네트워크가 잦아들 때까지 조건 기반으로 대기한 뒤 캡처한다(빈 화면 캡처 방지).
    await this.page
      .waitForFunction(() => !!document.body && document.body.innerText.trim().length > 0, undefined, {
        timeout: 8000,
      })
      .catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
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
