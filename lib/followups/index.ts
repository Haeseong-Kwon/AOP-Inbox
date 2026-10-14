import "server-only";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { actionAnalysisCache, executionJobs, items, notifications, usageFeedback, user, type ExecutionJob } from "@/db/schema";
import { db } from "@/lib/db";
import { expireStaleJobs } from "@/lib/execution/jobs";
import { pruneInbound } from "@/lib/instagram";
import { pruneEmptyAutoCollections, registerJobHandler } from "@/lib/ingestion/pipeline";
import { enqueue, type Job } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { notify, preferencesFor } from "@/lib/notify";

/**
 * Follow-ups exist to answer one question — did you actually use it? — not to
 * drive engagement. D+3 nudges with the usage hint, D+7 asks once whether it
 * was useful, and both stop as soon as the person answers.
 */

const DAY = 86_400_000;
const ANSWERED = ["used", "useful", "not_using", "rolled_back"] as const;

export async function scheduleFollowUps(job: ExecutionJob): Promise<void> {
  const base = (job.completedAt ?? new Date()).getTime();
  for (const [kind, days] of [["d3", 3], ["d7", 7]] as const) {
    await enqueue({ type: "follow_up", itemId: job.itemId ?? undefined, payload: { jobId: job.id, kind }, idempotencyKey: `follow_up:${kind}:${job.id}`, runAfter: new Date(base + days * DAY) });
  }
}

/** "Remind me later" re-arms D+3 two days out. */
export async function remindLater(job: ExecutionJob): Promise<void> {
  await enqueue({
    type: "follow_up",
    itemId: job.itemId ?? undefined,
    payload: { jobId: job.id, kind: "d3" },
    idempotencyKey: `follow_up:later:${job.id}:${Date.now()}`,
    runAfter: new Date(Date.now() + 2 * DAY),
  });
}

async function hasAnswer(itemId: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: usageFeedback.id })
    .from(usageFeedback)
    .where(and(eq(usageFeedback.itemId, itemId), inArray(usageFeedback.kind, [...ANSWERED]), gte(usageFeedback.createdAt, since)))
    .limit(1);
  return rows.length > 0;
}

async function runFollowUp(job: Job): Promise<void> {
  const { jobId, kind } = job.payload as { jobId?: string; kind?: "d3" | "d7" };
  if (!jobId || !kind) return;
  const [exec] = await db.select().from(executionJobs).where(eq(executionJobs.id, jobId));
  if (!exec || exec.status !== "done" || !exec.itemId) return; // undone, failed or item deleted
  const prefs = await preferencesFor(exec.userId);
  if (!prefs.followUps) return;
  if (await hasAnswer(exec.itemId, exec.completedAt ?? exec.createdAt)) return;
  const hint = exec.spec.usageHint;
  await notify({
    userId: exec.userId,
    kind: kind === "d3" ? "follow_up_d3" : "follow_up_d7",
    title: kind === "d3" ? `You set this up ${Math.max(1, Math.round((Date.now() - (exec.completedAt ?? exec.createdAt).getTime()) / DAY))} days ago` : "Did this setup turn out to be useful?",
    body: kind === "d3" ? (hint ? `Try it with: “${hint}”` : exec.itemTitle) : exec.itemTitle,
    itemId: exec.itemId,
    jobId: exec.id,
    // "Remind me later" re-runs D+3 under a fresh key, so it gets its own notification.
    dedupeKey: job.idempotencyKey.includes(":later:") ? job.idempotencyKey : `follow_up:${kind}:${exec.id}`,
  });
}

/** At most one "you saved this but never opened it" nudge per user per day. */
async function resurface(): Promise<number> {
  const users = await db.select({ id: user.id }).from(user);
  let sent = 0;
  for (const { id } of users) {
    const prefs = await preferencesFor(id);
    if (!prefs.followUps) continue;
    const today = new Date().toISOString().slice(0, 10);
    const [already] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.dedupeKey, `resurface-day:${id}:${today}`));
    if (already) continue;
    const [candidate] = await db
      .select({ id: items.id, title: items.aiTitle, savedAt: items.savedAt })
      .from(items)
      .where(
        and(
          eq(items.userId, id),
          eq(items.status, "unread"),
          gte(items.importanceScore, 0.7),
          lte(items.savedAt, new Date(Date.now() - 5 * DAY)),
          sql`not exists (select 1 from notifications n where n.item_id = ${items.id} and n.kind = 'resurface')`,
        ),
      )
      .orderBy(desc(items.importanceScore))
      .limit(1);
    if (!candidate) continue;
    const days = Math.round((Date.now() - candidate.savedAt.getTime()) / DAY);
    await notify({
      userId: id,
      kind: "resurface",
      title: `You saved this ${days} days ago but haven't opened it`,
      body: candidate.title ?? undefined,
      itemId: candidate.id,
      dedupeKey: `resurface-day:${id}:${today}`,
    });
    sent++;
  }
  return sent;
}

const RETENTION = { analysisCacheDays: 90, resolvedNotificationDays: 60 };

async function maintenance(): Promise<void> {
  const expired = await expireStaleJobs();
  const resurfaced = await resurface();
  await db.delete(actionAnalysisCache).where(lt(actionAnalysisCache.createdAt, new Date(Date.now() - RETENTION.analysisCacheDays * DAY)));
  await db
    .delete(notifications)
    .where(and(lt(notifications.createdAt, new Date(Date.now() - RETENTION.resolvedNotificationDays * DAY)), sql`(${notifications.resolvedAt} is not null or ${notifications.readAt} is not null)`));
  const inboundPruned = await pruneInbound();
  const emptied = await pruneEmptyAutoCollections();
  log.info("maintenance.done", { expired, resurfaced, inboundPruned, emptyCollections: emptied.collections, unusedTags: emptied.tags });
}

/** One maintenance job per hour; cheap to call on every drain. */
export async function ensureMaintenanceScheduled(): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13);
  await enqueue({ type: "maintenance", idempotencyKey: `maintenance:${hour}` });
}

let registered = false;
export function registerFollowUpHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler("follow_up", runFollowUp);
  registerJobHandler("maintenance", maintenance);
}

