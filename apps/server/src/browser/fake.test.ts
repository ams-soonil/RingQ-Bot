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
