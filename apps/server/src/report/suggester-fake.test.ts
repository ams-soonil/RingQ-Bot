import { describe, it, expect } from 'vitest';
import { createFakeSuggester } from './suggester-fake.js';

describe('fake suggester', () => {
  it('주어진 텍스트를 반환한다', async () => {
    const s = createFakeSuggester('이렇게 고치세요');
    expect(await s.suggest([], [])).toBe('이렇게 고치세요');
  });
});
