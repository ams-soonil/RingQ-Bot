import Database from 'better-sqlite3';
import type { ProjectInput, Run, RunPhase, RunStatus, TestCase, RunCapture, Finding } from '@ringq/shared';

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
  saveCaptures(runId: string, captures: RunCapture[]): void;
  listCaptures(runId: string): RunCapture[];
  saveFindings(runId: string, findings: Finding[]): void;
  listFindings(runId: string): Finding[];
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

interface CaptureRow {
  run_id: string;
  case_id: string;
  type: string;
  url: string;
  texts: string;
  elements: string;
  screenshot_path: string | null;
  flow_ok: number | null;
  error: string | null;
}

function rowToCapture(row: CaptureRow): RunCapture {
  return {
    caseId: row.case_id,
    runId: row.run_id,
    type: row.type as RunCapture['type'],
    url: row.url,
    texts: JSON.parse(row.texts),
    elements: JSON.parse(row.elements),
    screenshotPath: row.screenshot_path ?? undefined,
    flowOk: row.flow_ok === null ? undefined : row.flow_ok === 1,
    error: row.error ?? undefined,
  };
}

interface FindingRow {
  id: string;
  run_id: string;
  case_id: string;
  category: string;
  severity: string;
  message: string;
  source: string;
}

function rowToFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    category: row.category,
    severity: row.severity as Finding['severity'],
    message: row.message,
    source: row.source as Finding['source'],
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
    CREATE TABLE IF NOT EXISTS captures (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      texts TEXT NOT NULL,
      elements TEXT NOT NULL,
      screenshot_path TEXT,
      flow_ok INTEGER,
      error TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      run_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL
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
    saveCaptures(runId, captures) {
      const del = db.prepare(`DELETE FROM captures WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO captures (run_id, case_id, type, url, texts, elements, screenshot_path, flow_ok, error)
         VALUES (@run_id, @case_id, @type, @url, @texts, @elements, @screenshot_path, @flow_ok, @error)`,
      );
      const tx = db.transaction((rows: RunCapture[]) => {
        del.run(runId);
        for (const c of rows) {
          ins.run({
            run_id: runId,
            case_id: c.caseId,
            type: c.type,
            url: c.url,
            texts: JSON.stringify(c.texts),
            elements: JSON.stringify(c.elements),
            screenshot_path: c.screenshotPath ?? null,
            flow_ok: c.flowOk === undefined ? null : c.flowOk ? 1 : 0,
            error: c.error ?? null,
          });
        }
      });
      tx(captures);
    },
    listCaptures(runId) {
      const rows = db.prepare(`SELECT * FROM captures WHERE run_id = ? ORDER BY seq ASC`).all(runId) as CaptureRow[];
      return rows.map(rowToCapture);
    },
    saveFindings(runId, findings) {
      const del = db.prepare(`DELETE FROM findings WHERE run_id = ?`);
      const ins = db.prepare(
        `INSERT INTO findings (id, run_id, case_id, category, severity, message, source)
         VALUES (@id, @run_id, @case_id, @category, @severity, @message, @source)`,
      );
      const tx = db.transaction((rows: Finding[]) => {
        del.run(runId);
        for (const f of rows) {
          ins.run({
            id: f.id,
            run_id: runId,
            case_id: f.caseId,
            category: f.category,
            severity: f.severity,
            message: f.message,
            source: f.source,
          });
        }
      });
      tx(findings);
    },
    listFindings(runId) {
      const rows = db.prepare(`SELECT * FROM findings WHERE run_id = ? ORDER BY seq ASC`).all(runId) as FindingRow[];
      return rows.map(rowToFinding);
    },
  };
}
