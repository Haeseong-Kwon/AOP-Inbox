import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  ACTIVE_STATUSES,
  assertTransition,
  evaluateSpec,
  failureMessage,
  touchedTargets,
  type ExecutionStatus,
  type PlannedAction,
  type StepResult,
} from "@aop-inbox/core";
import { executionJobs, executionSteps, items, jobEvents, setupSpecs, usageFeedback, type ExecutionJob } from "@/db/schema";
import { syncItemActionState } from "@/lib/actions/state";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { log } from "@/lib/log";
import { notify } from "@/lib/notify";
import { primaryDevice } from "./devices";

/**
 * Execution jobs. Every status change goes through `transition()`, which
 * validates against the core state machine, appends to the event ledger and
 * re-syncs the item. Nothing here runs commands — the device does.
 */

export const OFFLINE_EXPIRY_MS = 7 * 86_400_000;

export async function appendEvent(jobId: string, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await db.insert(jobEvents).values({ jobId, type, payload });
}

type Patch = Partial<Pick<ExecutionJob, "approvedStepIds" | "approvedAt" | "plan" | "errorCode" | "errorDetail" | "startedAt" | "completedAt" | "dispatchedAt">>;

export async function transition(job: ExecutionJob, to: ExecutionStatus, event: string, payload: Record<string, unknown> = {}, patch: Patch = {}): Promise<ExecutionJob> {
  assertTransition(job.status, to);
  // Optimistic concurrency: only move from the status we read.
  const [updated] = await db
    .update(executionJobs)
    .set({ status: to, ...patch })
    .where(and(eq(executionJobs.id, job.id), eq(executionJobs.status, job.status)))
    .returning();
  if (!updated) throw new HttpError(409, "This setup changed in the meantime. Refresh and try again.");
  await appendEvent(job.id, event, { from: job.status, to, ...payload });
  if (job.itemId) await syncItemActionState(job.itemId);
  return updated;
}

export async function getOwnedJob(userId: string, jobId: string): Promise<ExecutionJob> {
  const [job] = await db.select().from(executionJobs).where(and(eq(executionJobs.id, jobId), eq(executionJobs.userId, userId)));
  if (!job) throw new HttpError(404, "This setup doesn't exist.");
  return job;
}

/** Other active jobs touching the same files / MCP names → "Potential conflict". */
export async function findConflicts(userId: string, targets: string[], excludeItemId?: string): Promise<{ jobId: string; itemTitle: string; targets: string[] }[]> {
  if (targets.length === 0) return [];
  const active = await db
    .select({ id: executionJobs.id, itemId: executionJobs.itemId, itemTitle: executionJobs.itemTitle, spec: executionJobs.spec })
    .from(executionJobs)
    .where(and(eq(executionJobs.userId, userId), inArray(executionJobs.status, [...ACTIVE_STATUSES, "done"])));
  return active
    .filter((j) => j.itemId !== excludeItemId)
    .map((j) => ({ jobId: j.id, itemTitle: j.itemTitle, targets: touchedTargets(j.spec).filter((t) => targets.includes(t)) }))
    .filter((c) => c.targets.length > 0);
}

/** "Run with AOP Inbox": create a job for the item's latest spec. The device dry-runs it first. */
export async function createExecutionJob(userId: string, itemId: string): Promise<ExecutionJob> {
  const item = await db.query.items.findFirst({ where: and(eq(items.id, itemId), eq(items.userId, userId)) });
  if (!item) throw new HttpError(404, "This item doesn't exist anymore.");
  const [spec] = await db.select().from(setupSpecs).where(eq(setupSpecs.itemId, itemId)).orderBy(desc(setupSpecs.revision)).limit(1);
  if (!spec) throw new HttpError(409, "There's no setup plan for this item yet.");

  const device = await primaryDevice(userId);
  if (!device) throw new HttpError(409, "Connect your Mac first (Settings → Local Agent), or follow the steps manually.");

  const policy = evaluateSpec(spec.spec, { autoRunLow: device.autoRunLow });
  if (policy.decision === "blocked") throw new HttpError(409, failureMessage("POLICY_DENIED"));
  if (policy.decision === "none" || policy.decision === "manual_only") throw new HttpError(409, "Nothing here can run automatically — follow the steps manually.");

  const [existing] = await db
    .select()
    .from(executionJobs)
    .where(and(eq(executionJobs.itemId, itemId), inArray(executionJobs.status, [...ACTIVE_STATUSES])))
    .limit(1);
  if (existing) return existing;

  const [job] = await db
    .insert(executionJobs)
    .values({
      userId,
      itemId,
      itemTitle: item.aiTitle ?? item.originalTitle ?? spec.spec.summary,
      setupSpecId: spec.id,
      specRevision: spec.revision,
      spec: spec.spec,
      deviceId: device.id,
      status: "planning",
      risk: policy.risk,
      expiresAt: new Date(Date.now() + OFFLINE_EXPIRY_MS),
    })
    .returning();
  await db.insert(executionSteps).values(spec.spec.steps.map((s, i) => ({ jobId: job.id, stepId: s.id, position: i, title: s.title })));
  await appendEvent(job.id, "setup_spec_used", { revision: spec.revision, specVersion: spec.specVersion, promptVersion: spec.promptVersion, model: spec.model });
  await appendEvent(job.id, "policy_checked", { decision: policy.decision, risk: policy.risk, steps: policy.steps.map((s) => ({ id: s.stepId, risk: s.risk, decision: s.decision })) });
  await syncItemActionState(itemId);
  await track(userId, "execution_started", { itemId, props: { risk: policy.risk } });
  return job;
}

/** Device finished the dry run. Low-only plans on an auto-run device go straight to the queue. */
export async function recordPlan(job: ExecutionJob, plan: PlannedAction[], autoRunLow: boolean): Promise<void> {
  const policy = evaluateSpec(job.spec, { autoRunLow });
  if (policy.decision === "blocked") {
    await transition(job, "failed", "policy_denied", {}, { plan, errorCode: "POLICY_DENIED", errorDetail: policy.blockedReasons.slice(0, 5).join("\n") });
    return;
  }
  const autoIds = policy.steps.filter((s) => s.decision === "auto").map((s) => s.stepId);
  if (policy.decision === "auto") {
    await transition(job, "queued", "dry_run_completed", { autoRun: true }, { plan, approvedStepIds: autoIds, dispatchedAt: null });
    return;
  }
  const updated = await transition(job, "awaiting_approval", "dry_run_completed", {}, { plan, dispatchedAt: null });
  await appendEvent(job.id, "approval_requested", { risk: policy.risk });
  await notify({
    userId: updated.userId,
    kind: "approval_required",
    title: "A setup needs your approval",
    body: updated.itemTitle,
    itemId: updated.itemId,
    jobId: updated.id,
    dedupeKey: `approval:${updated.id}`,
    critical: true,
  });
}

export async function approveJob(userId: string, jobId: string): Promise<ExecutionJob> {
  const job = await getOwnedJob(userId, jobId);
  if (job.status !== "awaiting_approval") throw new HttpError(409, "This setup isn't waiting for approval.");
  const policy = evaluateSpec(job.spec, { autoRunLow: false });
  if (policy.decision === "blocked") throw new HttpError(409, failureMessage("POLICY_DENIED"));
  const approved = policy.steps.filter((s) => s.decision === "approve" || s.decision === "auto").map((s) => s.stepId);
  const updated = await transition(job, "queued", "approval_granted", { steps: approved }, { approvedStepIds: approved, approvedAt: new Date(), dispatchedAt: null });
  await resolveNotifications(jobId, "approval_required");
  return updated;
}

export async function rejectJob(userId: string, jobId: string): Promise<ExecutionJob> {
  const job = await getOwnedJob(userId, jobId);
  if (job.status !== "awaiting_approval" && job.status !== "planning" && job.status !== "queued") throw new HttpError(409, "This setup can't be cancelled now.");
  const updated = await transition(job, "cancelled", job.status === "awaiting_approval" ? "approval_rejected" : "job_cancelled");
  await resolveNotifications(jobId);
  return updated;
}

/** The person finished a user_action step; resume on the device. */
export async function continueJob(userId: string, jobId: string): Promise<ExecutionJob> {
  const job = await getOwnedJob(userId, jobId);
  if (job.status !== "needs_user_action") throw new HttpError(409, "This setup isn't waiting for you.");
  const pending = await db.select().from(executionSteps).where(and(eq(executionSteps.jobId, jobId), eq(executionSteps.status, "needs_user")));
  for (const step of pending) await db.update(executionSteps).set({ status: "done" }).where(eq(executionSteps.id, step.id));
  const updated = await transition(job, "queued", "user_action_completed", { steps: pending.map((s) => s.stepId) }, { dispatchedAt: null });
  await resolveNotifications(jobId, "user_action");
  return updated;
}

export async function requestUndo(userId: string, jobId: string): Promise<ExecutionJob> {
  const job = await getOwnedJob(userId, jobId);
  if (job.status !== "done" && job.status !== "failed" && job.status !== "needs_user_action") throw new HttpError(409, "Only finished setups can be undone.");
  const updated = await transition(job, "rolling_back", "rollback_requested", {}, { dispatchedAt: null });
  await track(userId, "rollback_used", { itemId: job.itemId });
  return updated;
}

/* ─── Device events (already authenticated + ownership-checked by the caller) ─── */

export async function recordStepResult(job: ExecutionJob, result: StepResult): Promise<void> {
  const status = result.outcome === "needs_user" ? "needs_user" : result.outcome;
  await db
    .update(executionSteps)
    .set({ status, result })
    .where(and(eq(executionSteps.jobId, job.id), eq(executionSteps.stepId, result.stepId)));
  for (const id of result.snapshotIds) await appendEvent(job.id, "snapshot_created", { stepId: result.stepId, snapshotId: id });
  await appendEvent(job.id, result.outcome === "skipped" ? "step_skipped" : result.outcome === "failed" ? "step_failed" : "step_completed", {
    stepId: result.stepId,
    summary: result.summary,
    changedFiles: result.changedFiles,
    installed: result.installed,
  });
  if (result.verify) await appendEvent(job.id, result.verify.ok ? "verify_passed" : "verify_failed", { stepId: result.stepId, ...result.verify });
}

export async function completeJob(job: ExecutionJob): Promise<void> {
  let current = job;
  if (current.status === "executing") current = await transition(current, "verifying", "verifying");
  const done = await transition(current, "done", "job_completed", {}, { completedAt: new Date() });
  if (done.itemId) {
    await db.update(items).set({ appliedAt: new Date() }).where(eq(items.id, done.itemId));
    await syncItemActionState(done.itemId);
    const { scheduleFollowUps } = await import("@/lib/followups");
    await scheduleFollowUps(done);
  }
  await notify({ userId: done.userId, kind: "execution_result", title: "Setup applied", body: done.itemTitle, itemId: done.itemId, jobId: done.id, dedupeKey: `result:${done.id}`, critical: true });
  await track(done.userId, "execution_completed", { itemId: done.itemId });
}

export async function failJob(job: ExecutionJob, code: string, detail: string, rolledBack: boolean): Promise<void> {
  const failed = await transition(job, "failed", "job_failed", { code, rolledBack }, { errorCode: code, errorDetail: detail.slice(0, 1000), completedAt: new Date() });
  if (rolledBack) await appendEvent(job.id, "rollback_completed", { automatic: true });
  await notify({
    userId: failed.userId,
    kind: "execution_result",
    title: failureMessage(code),
    body: rolledBack ? `${failed.itemTitle} — your previous configuration was restored.` : failed.itemTitle,
    itemId: failed.itemId,
    jobId: failed.id,
    dedupeKey: `result:${failed.id}`,
    critical: true,
  });
  await track(failed.userId, "execution_failed", { itemId: failed.itemId, props: { code } });
  log.warn("execution.failed", { jobId: job.id, code, rolledBack });
}

export async function finishRollback(job: ExecutionJob, ok: boolean, detail: string): Promise<void> {
  if (ok) {
    await transition(job, "rolled_back", "rollback_completed", { detail: detail.slice(0, 500) }, { completedAt: new Date() });
    if (job.itemId) {
      await db.update(items).set({ appliedAt: null }).where(eq(items.id, job.itemId));
      await db.insert(usageFeedback).values({ userId: job.userId, itemId: job.itemId, jobId: job.id, kind: "rolled_back" });
      await syncItemActionState(job.itemId);
    }
  } else {
    await transition(job, "failed", "rollback_failed", { detail: detail.slice(0, 500) }, { errorCode: "ROLLBACK_FAILED", errorDetail: detail.slice(0, 1000) });
  }
}

export async function resolveNotifications(jobId: string, kind?: string): Promise<void> {
  const { notifications } = await import("@/db/schema");
  await db
    .update(notifications)
    .set({ resolvedAt: new Date() })
    .where(and(eq(notifications.jobId, jobId), kind ? eq(notifications.kind, kind as never) : sql`true`));
}

/** Jobs the device never picked up (offline) or the person never approved expire after 7 days. */
export async function expireStaleJobs(): Promise<number> {
  const stale = await db
    .select()
    .from(executionJobs)
    .where(and(inArray(executionJobs.status, ["planning", "awaiting_approval", "queued"]), lt(executionJobs.expiresAt, new Date())));
  for (const job of stale) {
    await transition(job, "expired", "job_expired", {}, { errorCode: job.status === "awaiting_approval" ? "APPROVAL_TIMEOUT" : "EXPIRED" });
  }
  return stale.length;
}
