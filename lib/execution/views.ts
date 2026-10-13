import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { evaluateSpec, explainStep, failureMessage, manualChecklist, staticPlan, STATUS_LABELS, touchedTargets, type ExecutionStatus } from "@aop-inbox/core";
import { executionJobs, executionSteps, items, jobEvents, notifications, setupSpecs, usageFeedback, type Device, type ExecutionJob } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { preferencesFor } from "@/lib/notify";
import { isOnline, primaryDevice } from "./devices";
import { LATEST_AGENT_VERSION } from "./gateway";
import { findConflicts } from "./jobs";
import type { ActivityEntry, DeviceView, JobView, NotificationView, SetupView } from "./types";

export function deviceView(d: Device): DeviceView {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    arch: d.arch,
    agentVersion: d.agentVersion,
    online: isOnline(d),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    paused: d.paused,
    autoRunLow: d.autoRunLow,
    updateAvailable: Boolean(d.agentVersion && d.agentVersion !== LATEST_AGENT_VERSION),
  };
}

export async function jobView(job: ExecutionJob): Promise<JobView> {
  const steps = await db.select().from(executionSteps).where(eq(executionSteps.jobId, job.id)).orderBy(asc(executionSteps.position));
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).orderBy(asc(jobEvents.createdAt));
  return {
    id: job.id,
    itemId: job.itemId,
    itemTitle: job.itemTitle,
    status: job.status,
    statusLabel: STATUS_LABELS[job.status],
    risk: job.risk,
    specRevision: job.specRevision,
    plan: job.plan,
    errorCode: job.errorCode,
    errorMessage: job.errorCode ? failureMessage(job.errorCode) : null,
    errorDetail: job.errorDetail,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    agentVersion: job.agentVersion,
    os: job.os,
    arch: job.arch,
    steps: steps.map((s) => ({ stepId: s.stepId, title: s.title, status: s.status, result: s.result ?? null })),
    events: events.map((e) => ({ type: e.type, at: e.createdAt.toISOString(), payload: e.payload })),
    usageHint: job.spec.usageHint ?? null,
  };
}

export async function setupView(userId: string, itemId: string): Promise<SetupView | null> {
  const item = await db.query.items.findFirst({ where: and(eq(items.id, itemId), eq(items.userId, userId)), columns: { id: true } });
  if (!item) throw new HttpError(404, "This item doesn't exist anymore.");
  const [spec] = await db.select().from(setupSpecs).where(eq(setupSpecs.itemId, itemId)).orderBy(desc(setupSpecs.revision)).limit(1);
  if (!spec) return null;
  const device = await primaryDevice(userId);
  const prefs = await preferencesFor(userId);
  const policy = evaluateSpec(spec.spec, { autoRunLow: device?.autoRunLow ?? false });
  const jobs = await db.select().from(executionJobs).where(and(eq(executionJobs.itemId, itemId), eq(executionJobs.userId, userId))).orderBy(desc(executionJobs.createdAt)).limit(10);
  const latest = jobs[0] ? await jobView(jobs[0]) : null;
  return {
    itemId,
    revision: spec.revision,
    createdAt: spec.createdAt.toISOString(),
    model: spec.model,
    spec: spec.spec,
    policy,
    explain: Object.fromEntries(spec.spec.steps.map((s) => [s.id, explainStep(s)])),
    plan: latest?.plan && latest.specRevision === spec.revision ? latest.plan : staticPlan(spec.spec),
    checklist: manualChecklist(spec.spec),
    conflicts: await findConflicts(userId, touchedTargets(spec.spec), itemId),
    device: device ? deviceView(device) : null,
    executionPaused: prefs.executionPaused,
    job: latest,
    history: jobs.map((j) => ({ id: j.id, status: j.status, statusLabel: STATUS_LABELS[j.status], createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null })),
  };
}

export async function activity(userId: string, limit = 50): Promise<ActivityEntry[]> {
  const jobs = await db.select().from(executionJobs).where(eq(executionJobs.userId, userId)).orderBy(desc(executionJobs.createdAt)).limit(limit);
  if (jobs.length === 0) return [];
  const ids = jobs.map((j) => j.id);
  const steps = await db.select().from(executionSteps).where(inArray(executionSteps.jobId, ids));
  const feedback = await db.select().from(usageFeedback).where(and(eq(usageFeedback.userId, userId), inArray(usageFeedback.jobId, ids))).orderBy(desc(usageFeedback.createdAt));
  return jobs.map((j) => {
    const s = steps.filter((x) => x.jobId === j.id && x.result);
    return {
      jobId: j.id,
      itemId: j.itemId,
      itemTitle: j.itemTitle,
      status: j.status as ExecutionStatus,
      statusLabel: STATUS_LABELS[j.status],
      risk: j.risk,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
      changed: [...new Set(s.flatMap((x) => x.result!.changedFiles.map((f) => f.path)))],
      installed: [...new Set(s.flatMap((x) => x.result!.installed))],
      verified: s.filter((x) => x.result!.verify?.ok).length,
      feedback: feedback.find((f) => f.jobId === j.id)?.kind ?? null,
    };
  });
}

export async function notificationsFor(userId: string): Promise<NotificationView[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.resolvedAt), lte(notifications.deliverAfter, new Date())))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  return rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, itemId: n.itemId, jobId: n.jobId, createdAt: n.createdAt.toISOString(), read: Boolean(n.readAt) }));
}
