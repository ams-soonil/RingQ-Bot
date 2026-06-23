import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFigmaUrl, createFigmaClient } from './client.js';

const nodesSample = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/nodes.sample.json', import.meta.url)), 'utf8'),
);

describe('parseFigmaUrl', () => {
  it('fileKey와 node-id를 파싱하고 1-2를 1:2로 정규화한다', () => {
    const r = parseFigmaUrl('https://www.figma.com/file/ABC123/My?node-id=1-2');
    expect(r.fileKey).toBe('ABC123');
    expect(r.nodeIds).toEqual(['1:2']);
  });

  it('/design/ 경로도 지원한다', () => {
    const r = parseFigmaUrl('https://www.figma.com/design/XYZ/Proj?node-id=10-20&t=x');
    expect(r.fileKey).toBe('XYZ');
    expect(r.nodeIds).toEqual(['10:20']);
  });

  it('node-id가 없으면 빈 배열', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/ABC/My').nodeIds).toEqual([]);
  });
});

describe('FigmaClient.fetchExtract', () => {
  it('노드 트리와 이미지를 받아 프레임/전환을 추출한다', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/v1/files/')) {
        return { ok: true, status: 200, json: async () => nodesSample } as Response;
      }
      if (url.includes('/v1/images/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ images: { '1:2': 'https://img/1-2.png', '1:9': 'https://img/1-9.png' } }),
        } as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = createFigmaClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    const extract = await client.fetchExtract('https://www.figma.com/file/ABC123/My?node-id=1-2');

    expect(extract.fileKey).toBe('ABC123');
    const login = extract.frames.find((f) => f.nodeId === '1:2')!;
    expect(login.name).toBe('로그인');
    expect(login.texts).toContain('로그인');
    expect(login.colors).toContain('#ff0000');
    expect(login.elements.map((e) => e.name)).toContain('로그인 버튼');
    expect(login.imageUrl).toBe('https://img/1-2.png');
    expect(extract.transitions).toContainEqual({ fromNodeId: '1:4', toNodeId: '1:9', trigger: 'ON_CLICK' });
    // X-Figma-Token 헤더 전송 확인
    const firstCall = fetchImpl.mock.calls[0];
    expect((firstCall[1] as RequestInit).headers).toMatchObject({ 'X-Figma-Token': 't' });
  });

  it('figma API 오류 시 throw한다', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) as Response);
    const client = createFigmaClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      client.fetchExtract('https://www.figma.com/file/ABC/My?node-id=1-2'),
    ).rejects.toThrow(/figma API 403/);
  });
});
