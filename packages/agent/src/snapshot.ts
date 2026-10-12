import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Ledger, SnapshotRecord } from "./ledger";

/**
 * Before any file is changed, its current state is copied (or recorded as
 * absent). No snapshot → no destructive change; executors refuse instead.
 */

export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export class SnapshotError extends Error {}

export class SnapshotStore {
  constructor(private dir: string, private ledger: Ledger) {}

  capture(jobId: string, stepId: string, target: string): SnapshotRecord {
    const id = randomUUID();
    const capturedAt = new Date().toISOString();
    if (!existsSync(target)) {
      const rec: SnapshotRecord = { id, jobId, stepId, kind: "absent", originalPath: target, snapshotPath: null, sha256: null, capturedAt, meta: {} };
      this.ledger.addSnapshot(rec);
      return rec;
    }
    const st = lstatSync(target);
    if (st.isSymbolicLink()) throw new SnapshotError(`${target} is a symlink; AOP Inbox won't change files through links`);
    if (st.isDirectory()) throw new SnapshotError(`${target} is a directory`);
    if (st.size > MAX_SNAPSHOT_BYTES) throw new SnapshotError(`${target} is too large to snapshot safely (${Math.round(st.size / 1024 / 1024)} MB)`);
    const dir = path.join(this.dir, jobId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const snapshotPath = path.join(dir, `${id}${path.extname(target)}`);
    copyFileSync(target, snapshotPath);
    const sha256 = createHash("sha256").update(readFileSync(snapshotPath)).digest("hex");
    const rec: SnapshotRecord = { id, jobId, stepId, kind: "file", originalPath: target, snapshotPath, sha256, capturedAt, meta: { mode: statSync(target).mode & 0o777 } };
    this.ledger.addSnapshot(rec);
    return rec;
  }

  /** Put a file back exactly as it was (or remove it if it didn't exist). */
  restore(rec: SnapshotRecord): void {
    if (rec.kind === "absent") {
      if (existsSync(rec.originalPath)) rmSync(rec.originalPath, { recursive: true, force: true });
    } else if (rec.kind === "file" && rec.snapshotPath) {
      const data = readFileSync(rec.snapshotPath);
      if (createHash("sha256").update(data).digest("hex") !== rec.sha256) throw new SnapshotError(`Snapshot for ${rec.originalPath} is corrupted`);
      mkdirSync(path.dirname(rec.originalPath), { recursive: true });
      copyFileSync(rec.snapshotPath, rec.originalPath);
    }
    this.ledger.markRestored(rec.id);
  }

  /** Retention: snapshots are not kept forever. */
  cleanup(retentionDays: number): number {
    const before = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const old = this.ledger.oldSnapshots(before);
    for (const s of old) {
      if (s.snapshotPath) rmSync(s.snapshotPath, { force: true });
      this.ledger.deleteSnapshot(s.id);
    }
    return old.length;
  }
}
