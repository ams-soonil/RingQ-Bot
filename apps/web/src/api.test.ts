import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRun, fetchCases, confirmCases, fetchCaptures } from './api.js';

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

describe('fetchCases', () => {
  it('GET /api/runs/:id/cases 결과를 반환한다', async () => {
    const cases = [{ id: 'tc_1', type: 'ui', title: '로그인 UI' }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => cases });
    vi.stubGlobal('fetch', fetchMock);
    const got = await fetchCases('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/cases');
    expect(got).toHaveLength(1);
  });
});

describe('confirmCases', () => {
  it('POST /api/runs/:id/confirm 후 Run을 반환한다', async () => {
    const run = { id: 'run_1', phase: 'cases-confirmed' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => run });
    vi.stubGlobal('fetch', fetchMock);
    const got = await confirmCases('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/confirm', expect.objectContaining({ method: 'POST' }));
    expect(got.phase).toBe('cases-confirmed');
  });

  it('서버 실패 시 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    await expect(confirmCases('run_1')).rejects.toThrow();
  });
});

describe('fetchCaptures', () => {
  it('GET /api/runs/:id/captures 결과를 반환한다', async () => {
    const caps = [{ caseId: 'tc_1', type: 'ui', url: 'https://e.com', texts: [], elements: [] }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => caps });
    vi.stubGlobal('fetch', fetchMock);
    const got = await fetchCaptures('run_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run_1/captures');
    expect(got).toHaveLength(1);
  });

  it('서버 실패 시 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    await expect(fetchCaptures('run_1')).rejects.toThrow();
  });
});
