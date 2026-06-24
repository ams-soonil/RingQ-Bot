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
  /** 라벨/placeholder로 입력 필드를 찾아 값 입력. */
  fill(label: string, value: string): Promise<boolean>;
  /** 콤보박스/드롭다운(label)에서 옵션(value)을 선택. */
  selectOption(label: string, value: string): Promise<boolean>;
  /** 체크박스 체크(target: 라벨 텍스트 또는 'firstRow'). */
  check(target: string): Promise<boolean>;
  capture(screenshotPath?: string): Promise<CapturedScreen>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  open(): Promise<BrowserSession>;
}
