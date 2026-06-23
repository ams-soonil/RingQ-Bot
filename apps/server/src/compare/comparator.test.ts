import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.js';
import { createComparator } from './comparator.js';
import { createFakeVision } from './vision-fake.js';
import type { FigmaClient, FigmaExtract } from '../figma/client.js';
import type { TestCase, RunCapture } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://example.com' };
const extract: FigmaExtract = {
  fileKey: 'A',
  frames: [{ nodeId: '1:2', name: '로그인', texts: [], elements: [], colors: [], imageUrl: 'https://img/1-2.png' }],
  transitions: [],
};
const fakeFigma: FigmaClient = { fetchExtract: async () => extract };

function seed() {
  // Create a real temp file so existsSync(screenshotPath) passes in the vision path
  const tmpDir = mkdtempSync(join(tmpdir(), 'ringq-test-'));
  const screenshotPath = join(tmpDir, 'screenshot.png');
  writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // dummy PNG header

  const store = createStore(':memory:');
  const run = store.createRun(input);
  const cases: TestCase[] = [
    { id: 'tc_ui', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: '로그인 UI', figmaNodeId: '1:2', uiExpectation: { texts: ['로그인'], elements: [], colors: [] } },
  ];
  store.saveCases(run.id, cases);
  const caps: RunCapture[] = [
    { caseId: 'tc_ui', runId: run.id, type: 'ui', url: 'https://e.com', texts: [], elements: [], screenshotPath },
  ];
  store.saveCaptures(run.id, caps);
  return { store, runId: run.id };
}

describe('comparator', () => {
  it('구조 finding과 비전 finding을 병합하고 id를 부여한다', async () => {
    const { store, runId } = seed();
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: '여백 차이' }]);
    const comparator = createComparator({ store, figma: fakeFigma, vision });

    const findings = await comparator.compare(runId);

    // 구조: 기대 텍스트 '로그인'이 캡처 texts(빈 배열)에 없음 → missing-text
    expect(findings.some((f) => f.source === 'structural' && f.category === 'missing-text')).toBe(true);
    // 비전: fake가 준 layout finding
    expect(findings.some((f) => f.source === 'vision' && f.category === 'layout')).toBe(true);
    expect(findings.every((f) => f.id.startsWith('fd_'))).toBe(true);
    expect(findings.every((f) => f.runId === runId)).toBe(true);
  });

  it('figma 재조회 실패 시 비전은 스킵하고 구조 결과만 반환', async () => {
    const { store, runId } = seed();
    const failingFigma: FigmaClient = { fetchExtract: async () => { throw new Error('figma down'); } };
    const vision = createFakeVision([{ category: 'layout', severity: 'minor', message: 'x' }]);
    const comparator = createComparator({ store, figma: failingFigma, vision });

    const findings = await comparator.compare(runId);
    expect(findings.some((f) => f.source === 'structural')).toBe(true);
    expect(findings.some((f) => f.source === 'vision')).toBe(false);
  });
});
