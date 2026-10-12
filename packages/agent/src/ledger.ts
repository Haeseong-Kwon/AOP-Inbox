import { DatabaseSync } from "node:sqlite";

/**
 * Local execution ledger (SQLite). Survives network loss: what ran, which
 * snapshots exist, and events not yet delivered to the gateway (outbox).
 */

export interface SnapshotRecord {
  id: string;
  jobId: string;
  stepId: string;
  kind: "file" | "absent" | "mcp";
  originalPath: string;
  snapshotPath: string | null;
  sha256: string | null;
  capturedAt: string;
  meta: Record<string, unknown>;
}

export class Ledger {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists jobs (job_id text primary key, mode text not null, status text not null, spec_revision integer not null, spec_json text not null, updated_at text not null);
      create table if not exists steps (job_id text not null, step_id text not null, outcome text not null, result_json text not null, updated_at text not null, primary key (job_id, step_id));
      create table if not exists snapshots (id text primary key, job_id text not null, step_id text not null, kind text not null, original_path text not null, snapshot_path text, sha256 text, captured_at text not null, meta_json text not null, restored integer not null default 0);
      create table if not exists outbox (id integer primary key autoincrement, payload text not null, created_at text not null, sent_at text);
      create table if not exists log (id integer primary key autoincrement, job_id text, level text not null, message text not null, created_at text not null);
    `);
  }

  upsertJob(jobId: string, mode: string, status: string, specRevision: number, specJson: string): void {
    this.db
      .prepare(`insert into jobs values (?, ?, ?, ?, ?, ?) on conflict(job_id) do update set mode = excluded.mode, status = excluded.status, spec_revision = excluded.spec_revision, spec_json = excluded.spec_json, updated_at = excluded.updated_at`)
      .run(jobId, mode, status, specRevision, specJson, new Date().toISOString());
  }

  setJobStatus(jobId: string, status: string): void {
    this.db.prepare(`update jobs set status = ?, updated_at = ? where job_id = ?`).run(status, new Date().toISOString(), jobId);
  }

  job(jobId: string): { mode: string; status: string; specRevision: number; specJson: string } | null {
    const row = this.db.prepare(`select mode, status, spec_revision as specRevision, spec_json as specJson from jobs where job_id = ?`).get(jobId) as
      | { mode: string; status: string; specRevision: number; specJson: string }
      | undefined;
    return row ?? null;
  }

  recentJobs(limit = 20): { jobId: string; mode: string; status: string; updatedAt: string }[] {
    return this.db.prepare(`select job_id as jobId, mode, status, updated_at as updatedAt from jobs order by updated_at desc limit ?`).all(limit) as never;
  }

  recordStep(jobId: string, stepId: string, outcome: string, resultJson: string): void {
    this.db
      .prepare(`insert into steps values (?, ?, ?, ?, ?) on conflict(job_id, step_id) do update set outcome = excluded.outcome, result_json = excluded.result_json, updated_at = excluded.updated_at`)
      .run(jobId, stepId, outcome, resultJson, new Date().toISOString());
  }

  steps(jobId: string): { stepId: string; outcome: string; resultJson: string }[] {
    return this.db.prepare(`select step_id as stepId, outcome, result_json as resultJson from steps where job_id = ? order by updated_at`).all(jobId) as never;
  }

  addSnapshot(s: SnapshotRecord): void {
    this.db
      .prepare(`insert into snapshots (id, job_id, step_id, kind, original_path, snapshot_path, sha256, captured_at, meta_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.jobId, s.stepId, s.kind, s.originalPath, s.snapshotPath, s.sha256, s.capturedAt, JSON.stringify(s.meta));
  }

  snapshots(jobId: string, stepId?: string): SnapshotRecord[] {
    const rows = (stepId
      ? this.db.prepare(`select * from snapshots where job_id = ? and step_id = ? and restored = 0 order by captured_at desc`).all(jobId, stepId)
      : this.db.prepare(`select * from snapshots where job_id = ? and restored = 0 order by captured_at desc`).all(jobId)) as Record<string, string>[];
    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      stepId: r.step_id,
      kind: r.kind as SnapshotRecord["kind"],
      originalPath: r.original_path,
      snapshotPath: r.snapshot_path,
      sha256: r.sha256,
      capturedAt: r.captured_at,
      meta: JSON.parse(r.meta_json),
    }));
  }

  markRestored(id: string): void {
    this.db.prepare(`update snapshots set restored = 1 where id = ?`).run(id);
  }

  oldSnapshots(before: string): { id: string; snapshotPath: string | null }[] {
    return this.db.prepare(`select id, snapshot_path as snapshotPath from snapshots where captured_at < ?`).all(before) as never;
  }

  deleteSnapshot(id: string): void {
    this.db.prepare(`delete from snapshots where id = ?`).run(id);
  }

  enqueueEvent(payload: unknown): number {
    return Number(this.db.prepare(`insert into outbox (payload, created_at) values (?, ?)`).run(JSON.stringify(payload), new Date().toISOString()).lastInsertRowid);
  }

  pendingEvents(): { id: number; payload: string }[] {
    return this.db.prepare(`select id, payload from outbox where sent_at is null order by id`).all() as never;
  }

  markSent(id: number): void {
    this.db.prepare(`update outbox set sent_at = ? where id = ?`).run(new Date().toISOString(), id);
  }

  log(jobId: string | null, level: "info" | "warn" | "error", message: string): void {
    this.db.prepare(`insert into log (job_id, level, message, created_at) values (?, ?, ?, ?)`).run(jobId, level, message, new Date().toISOString());
  }

  logs(jobId?: string, limit = 200): { jobId: string | null; level: string; message: string; createdAt: string }[] {
    return (jobId
      ? this.db.prepare(`select job_id as jobId, level, message, created_at as createdAt from log where job_id = ? order by id desc limit ?`).all(jobId, limit)
      : this.db.prepare(`select job_id as jobId, level, message, created_at as createdAt from log order by id desc limit ?`).all(limit)) as never;
  }

  close(): void {
    this.db.close();
  }
}
