import Database from 'better-sqlite3';
import type { ProjectInput, Run, RunPhase, RunStatus } from '@ringq/shared';

export interface Store {
  createRun(input: ProjectInput): Run;
  getRun(id: string): Run | undefined;
  updateRun(id: string, patch: Partial<Pick<Run, 'phase' | 'status'>>): Run;
  listRuns(): Run[];
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
  };
}
