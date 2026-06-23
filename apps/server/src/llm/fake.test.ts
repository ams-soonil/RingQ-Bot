import { describe, it, expect } from 'vitest';
import { createFakeLLM } from './fake.js';
import type { LlmCaseDraft } from './types.js';

describe('fake LLM', () => {
  it('주어진 drafts를 그대로 반환한다', async () => {
    const drafts: LlmCaseDraft[] = [{ type: 'ui', title: '로그인 UI', figmaNodeId: '1:2' }];
    const llm = createFakeLLM(drafts);
    const extract = { fileKey: 'x', frames: [], transitions: [] };
    expect(await llm.proposeCases(extract)).toEqual(drafts);
  });
});
