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
