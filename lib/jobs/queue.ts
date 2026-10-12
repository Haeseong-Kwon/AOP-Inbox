import "server-only";
import { sql } from "drizzle-orm";
import { processingJobs, type JobType } from "@/db/schema";
import { db } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";

/**
 * Postgres-backed job queue (FOR UPDATE SKIP LOCKED). Small enough to read in
 * one sitting; swap for BullMQ / a cloud queue by re-implementing these four
 * functions — callers only use enqueue() and runJobs().
 */

export type Job = typeof processingJobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;

const STALE_LOCK = "10 minutes";
const BASE_BACKOFF_SECONDS = 15;

type Executor = Pick<typeof db, "execute">;

export async function enqueue(
  input: { type: JobType; itemId?: string; payload?: Record<string, unknown>; idempotencyKey: string; maxAttempts?: number },
  executor: Executor = db,
): Promise<void> {
  // Same key while pending/processing → no-op. Same key after it finished → re-arm it.
  await executor.execute(sql`
    insert into processing_jobs (type, item_id, payload, idempotency_key, max_attempts)
    values (${input.type}, ${input.itemId ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.idempotencyKey}, ${input.maxAttempts ?? 3})
    on conflict (idempotency_key) do update
      set status = 'pending', attempts = 0, run_after = now(), last_error = null, locked_at = null, completed_at = null, updated_at = now()
      where processing_jobs.status in ('completed', 'failed')`);
}

async function claim(limit: number): Promise<Job[]> {
  const rows = await db.execute(sql`
    update processing_jobs set status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id in (
      select id from processing_jobs
      where (status = 'pending' and run_after <= now())
         or (status = 'processing' and locked_at < now() - ${STALE_LOCK}::interval)
      order by run_after
      limit ${limit}
      for update skip locked
    )
    returning id`);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  return db.query.processingJobs.findMany({ where: (j, { inArray }) => inArray(j.id, ids) });
}

async function complete(job: Job) {
  await db.execute(sql`
    update processing_jobs set status = 'completed', completed_at = now(), locked_at = null, last_error = null, updated_at = now()
    where id = ${job.id}`);
}

/** Returns true when the job is out of retries. */
async function fail(job: Job, error: unknown): Promise<boolean> {
  const final = job.attempts >= job.maxAttempts;
  const delay = BASE_BACKOFF_SECONDS * 2 ** (job.attempts - 1);
  await db.execute(sql`
    update processing_jobs
    set status = ${final ? "failed" : "pending"}, locked_at = null, last_error = ${errorMessage(error).slice(0, 500)},
        run_after = now() + ${`${delay} seconds`}::interval, updated_at = now()
    where id = ${job.id}`);
  return final;
}

export interface RunOptions {
  handlers: Partial<Record<JobType, JobHandler>>;
  onFinalFailure?: (job: Job, error: unknown) => Promise<void>;
  concurrency?: number;
  /** Stop claiming new work after this long (keeps request-bound runs short). */
  budgetMs?: number;
}

let running = false;

/** Drain due jobs. Re-entrant calls in the same process are ignored. */
export async function runJobs({ handlers, onFinalFailure, concurrency = 3, budgetMs = 50_000 }: RunOptions): Promise<number> {
  if (running) return 0;
  running = true;
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  try {
    while (Date.now() < deadline) {
      const batch = await claim(concurrency);
      if (batch.length === 0) break;
      await Promise.all(
        batch.map(async (job) => {
          const startedAt = Date.now();
          try {
            const handler = handlers[job.type];
            if (!handler) throw new Error(`No handler for job type ${job.type}`);
            await handler(job);
            await complete(job);
            log.info("job.completed", { jobId: job.id, type: job.type, ms: Date.now() - startedAt });
          } catch (error) {
            const final = await fail(job, error);
            log.error("job.failed", { jobId: job.id, type: job.type, attempt: job.attempts, final, error: errorMessage(error) });
            if (final) await onFinalFailure?.(job, error).catch(() => {});
          }
          processed++;
        }),
      );
    }
  } finally {
    running = false;
  }
  return processed;
}
