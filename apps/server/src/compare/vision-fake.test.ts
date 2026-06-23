import { describe, it, expect } from 'vitest';
import { createFakeVision } from './vision-fake.js';

describe('fake vision', () => {
  it('주어진 findings를 반환한다', async () => {
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: '버튼 위치 다름' }]);
    const out = await vision.compare({ title: 't', figmaImageUrl: 'https://img', screenshotPath: 'x.png' });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('layout');
  });
});
