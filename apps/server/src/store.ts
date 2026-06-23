import Database from 'better-sqlite3';
import type { ProjectInput, Run, RunPhase, RunStatus, TestCase } from '@ringq/shared';

export interface Store {
  createRun(input: ProjectInput): Run;
  getRun(id: string): Run | undefined;
  updateRun(id: string, patch: Partial<Pick<Run, 'phase' | 'status'>>): Run;
  listRuns(): Run[];
  saveCases(runId: string, cases: TestCase[]): void;
  listCases(runId: string): TestCase[];
  updateCase(caseId: string, patch: Partial<Pick<TestCase, 'title' | 'status' | 'uiExpectation' | 'steps'>>): TestCase;
  addCase(testCase: TestCase): TestCase;
  confirmCases(runId: string): void;
}

interface CaseRow {
  id: string;
  run_id: string;
  type: string;
  source: string;
  status: string;
  title: string;
  figma_node_id: string | null;
  ui_expectation: string | null;
  steps: string | null;
  confidence: number | null;
}

function rowToCase(row: CaseRow): TestCase {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type as TestCase['type'],
    source: row.source as TestCase['source'],
    status: row.status as TestCase['status'],
    title: row.title,
    figmaNodeId: row.figma_node_id ?? undefined,
    uiExpectation: row.ui_expectation ? JSON.parse(row.ui_expectation) : undefined,
    steps: row.steps ? JSON.parse(row.steps) : undefined,
    confidence: row.confidence ?? undefined,
  };
}

interface Row {
  id: string;
  site_url: string;
  figma_links: string;
  git_url: string | null;
  phase: string;
  status: string;
  created_at: string;
  seq: number;
}

function rowToRun(row: Row): Run {
  return {
    id: row.id,
    siteUrl: row.site_url,
    figmaLinks: JSON.parse(row.figma_links) as string[],
    gitUrl: row.git_url ?? undefined,
    phase: row.phase as RunPhase,
    status: row.status as RunStatus,
    createdAt: row.created_at,
  };
}

export function createStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      site_url TEXT NOT NULL,
      figma_links TEXT NOT NULL,
      git_url TEXT,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_cases (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      figma_node_id TEXT,
      ui_expectation TEXT,
      steps TEXT,
      confidence REAL
    );
  `);

  return {
    createRun(input) {
      const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO runs (id, site_url, figma_links, git_url, phase, status, created_at)
         VALUES (@id, @site_url, @figma_links, @git_url, @phase, @status, @created_at)`,
      ).run({
        id,
        site_url: input.siteUrl,
        figma_links: JSON.stringify(input.figmaLinks),
        git_url: input.gitUrl ?? null,
        phase: 'queued',
        status: 'active',
        created_at: createdAt,
      });
      return this.getRun(id)!;
    },
    getRun(id) {
      const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Row | undefined;
      return row ? rowToRun(row) : undefined;
    },
    updateRun(id, patch) {
      const existing = this.getRun(id);
      if (!existing) throw new Error(`run not found: ${id}`);
      const next: Run = { ...existing, ...patch };
      db.prepare(`UPDATE runs SET phase = ?, status = ? WHERE id = ?`).run(
        next.phase,
        next.status,
        id,
      );
      return next;
    },
    listRuns() {
      const rows = db.prepare(`SELECT * FROM runs ORDER BY seq DESC`).all() as Row[];
      return rows.map(rowToRun);
    },
    saveCases(runId, cases) {
      const del = db.prepare(`DELETE FROM test_cases WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO test_cases (id, run_id, type, source, status, title, figma_node_id, ui_expectation, steps, confidence)
         VALUES (@id, @run_id, @type, @source, @status, @title, @figma_node_id, @ui_expectation, @steps, @confidence)`,
      );
      const tx = db.transaction((rows: TestCase[]) => {
        del.run(runId);
        for (const c of rows) {
          ins.run({
            id: c.id,
            run_id: runId,
            type: c.type,
            source: c.source,
            status: c.status,
            title: c.title,
            figma_node_id: c.figmaNodeId ?? null,
            ui_expectation: c.uiExpectation ? JSON.stringify(c.uiExpectation) : null,
            steps: c.steps ? JSON.stringify(c.steps) : null,
            confidence: c.confidence ?? null,
          });
        }
      });
      tx(cases);
    },
    listCases(runId) {
      const rows = db.prepare(`SELECT * FROM test_cases WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CaseRow[];
      return rows.map(rowToCase);
    },
    updateCase(caseId, patch) {
      const row = db.prepare(`SELECT * FROM test_cases WHERE id = ?`).get(caseId) as CaseRow | undefined;
      if (!row) throw new Error(`case not found: ${caseId}`);
      const current = rowToCase(row);
      const next: TestCase = { ...current, ...patch };
      db.prepare(
        `UPDATE test_cases SET title = ?, status = ?, ui_expectation = ?, steps = ? WHERE id = ?`,
      ).run(
        next.title,
        next.status,
        next.uiExpectation ? JSON.stringify(next.uiExpectation) : null,
        next.steps ? JSON.stringify(next.steps) : null,
        caseId,
      );
      return next;
    },
    addCase(testCase) {
      db.prepare(
        `INSERT INTO test_cases (id, run_id, type, source, status, title, figma_node_id, ui_expectation, steps, confidence)
         VALUES (@id, @run_id, @type, @source, @status, @title, @figma_node_id, @ui_expectation, @steps, @confidence)`,
      ).run({
        id: testCase.id,
        run_id: testCase.runId,
        type: testCase.type,
        source: testCase.source,
        status: testCase.status,
        title: testCase.title,
        figma_node_id: testCase.figmaNodeId ?? null,
        ui_expectation: testCase.uiExpectation ? JSON.stringify(testCase.uiExpectation) : null,
        steps: testCase.steps ? JSON.stringify(testCase.steps) : null,
        confidence: testCase.confidence ?? null,
      });
      return testCase;
    },
    confirmCases(runId) {
      db.prepare(`UPDATE test_cases SET status = 'confirmed' WHERE run_id = ? AND status = 'draft'`).run(runId);
    },
  };
}
