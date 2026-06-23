import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRun } from './api.js';

afterEach(() => vi.restoreAllMocks());

describe('createRun', () => {
  it('POST /api/runs로 입력을 보내고 Run을 반환한다', async () => {
    const fakeRun = { id: 'run_1', phase: 'queued' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeRun,
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = await createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(run.id).toBe('run_1');
  });

  it('서버가 실패하면 throw한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) }),
    );
    await expect(
      createRun({ figmaLinks: ['https://figma.com/x'], siteUrl: 'https://e.com' }),
    ).rejects.toThrow();
  });
});
