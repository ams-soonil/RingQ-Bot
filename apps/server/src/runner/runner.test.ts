import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.js';
import { createRunner } from './runner.js';
import { createFakeDriver } from '../browser/fake.js';
import type { TestCase } from '@ringq/shared';

const input = { figmaLinks: ['https://figma.com/file/A/x?node-id=1-2'], siteUrl: 'https://example.com' };

function seedConfirmed(creds?: { username: string; password: string }): { store: ReturnType<typeof createStore>; runId: string } {
  const store = createStore(':memory:');
  const run = store.createRun({ ...input, ...creds });
  const cases: TestCase[] = [
    { id: 'tc_ui', runId: run.id, type: 'ui', source: 'figma', status: 'confirmed', title: '로그인 UI', figmaNodeId: '1:2' },
    { id: 'tc_flow', runId: run.id, type: 'flow', source: 'figma', status: 'confirmed', title: '플로우', steps: [{ action: 'click', target: '로그인 버튼' }] },
    { id: 'tc_draft', runId: run.id, type: 'ui', source: 'figma', status: 'draft', title: '미확정' },
  ];
  store.saveCases(run.id, cases);
  return { store, runId: run.id };
}

describe('runner', () => {
  it('confirmed 케이스만 캡처한다 (draft 제외)', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ screen: { texts: ['환영'], elements: ['button'] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    const caps = await runner.run(runId);

    expect(caps.map((c) => c.caseId).sort()).toEqual(['tc_flow', 'tc_ui']);
    const ui = caps.find((c) => c.caseId === 'tc_ui')!;
    expect(ui.texts).toContain('환영');
    expect(ui.screenshotPath).toContain(runId);
  });

  it('flow step click 실패 시 flowOk=false', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ clicks: { '로그인 버튼': false }, screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    const caps = await runner.run(runId);
    expect(caps.find((c) => c.caseId === 'tc_flow')!.flowOk).toBe(false);
  });

  it('per-run creds가 있고 로그인 실패면 throw한다', async () => {
    const { store, runId } = seedConfirmed({ username: 'u', password: 'p' });
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ login: 'failed' });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    await expect(runner.run(runId)).rejects.toThrow(/로그인 실패/);
  });

  it('creds 없으면 로그인 시도하지 않는다', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ login: 'failed', screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir }); // creds 없음

    // 로그인 안 하므로 'failed'여도 throw 안 함
    const caps = await runner.run(runId);
    expect(caps.length).toBe(2);
  });

  it('로그인 성공 후 제공된 siteUrl로 다시 이동한다', async () => {
    const { store, runId } = seedConfirmed({ username: 'u', password: 'p' });
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ login: 'logged-in', screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    await runner.run(runId);

    const calls = driver.sessions[0].calls;
    const loginIdx = calls.indexOf('tryLogin');
    // tryLogin 직후 siteUrl로의 재이동(goto)이 있어야 한다
    expect(calls[loginIdx + 1]).toBe('goto:https://example.com');
  });

  it('UI 케이스는 routePath 없이도 항상 siteUrl로 이동 후 캡처한다', async () => {
    const { store, runId } = seedConfirmed();
    const dir = mkdtempSync(join(tmpdir(), 'ringq-'));
    const driver = createFakeDriver({ screen: { texts: [], elements: [] } });
    const runner = createRunner({ store, driver }, { artifactDir: dir });

    await runner.run(runId);

    const calls = driver.sessions[0].calls;
    // tc_ui(UI) 캡처 직전에 goto:siteUrl 이 있어야 한다 (capture 앞 goto)
    const captureIdx = calls.findIndex((c) => c.startsWith('capture:'));
    expect(calls[captureIdx - 1]).toBe('goto:https://example.com');
  });
});
