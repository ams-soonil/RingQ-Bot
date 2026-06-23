import { describe, it, expect } from 'vitest';
import { ProjectInputSchema, ProgressEventSchema } from './index.js';

describe('ProjectInputSchema', () => {
  it('유효한 입력을 통과시킨다', () => {
    const parsed = ProjectInputSchema.parse({
      figmaLinks: ['https://figma.com/file/abc'],
      siteUrl: 'https://example.com',
    });
    expect(parsed.figmaLinks).toHaveLength(1);
    expect(parsed.gitUrl).toBeUndefined();
  });

  it('figmaLinks가 비면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: [], siteUrl: 'https://example.com' }),
    ).toThrow();
  });

  it('siteUrl이 URL이 아니면 거부한다', () => {
    expect(() =>
      ProjectInputSchema.parse({ figmaLinks: ['https://figma.com/x'], siteUrl: 'not-a-url' }),
    ).toThrow();
  });
});

describe('ProgressEventSchema', () => {
  it('phase enum을 검증한다', () => {
    expect(() =>
      ProgressEventSchema.parse({ runId: 'r1', phase: 'invalid', message: 'x', at: 'now' }),
    ).toThrow();
  });
});
