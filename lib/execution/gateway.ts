import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DEVICE_BUSY_STATUSES, DispatchSchema, failureMessage, redactSecrets, type AgentEvent, type ServerMessage } from "@aop-inbox/core";
import { executionJobs, executionSteps, type Device, type ExecutionJob } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { log } from "@/lib/log";
import { notify, preferencesFor } from "@/lib/notify";
import { touchDevice } from "./devices";
import { appendEvent, completeJob, failJob, finishRollback, recordPlan, recordStepResult, transition } from "./jobs";

export const LATEST_AGENT_VERSION = "0.1.0";

/**
 * What the device should receive right now. Marks jobs as dispatched so a
 * second poll doesn't resend them; `agent.hello` clears the mark so a
 * reconnecting agent gets unfinished work again (its ledger dedupes).
 */
export async function messagesForDevice(device: Device): Promise<ServerMessage[]> {
  const prefs = await preferencesFor(device.userId);
  const paused = prefs.executionPaused || device.paused;
  const messages: ServerMessage[] = [{ type: "agent.config", paused, autoRunLow: device.autoRunLow, latestAgentVersion: LATEST_AGENT_VERSION }];

  const jobs = await db
    .select()
    .from(executionJobs)
    .where(and(eq(executionJobs.deviceId, device.id), eq(executionJobs.userId, device.userId), inArray(executionJobs.status, ["planning", "queued", "rolling_back", ...DEVICE_BUSY_STATUSES])));

  const busy = jobs.some((j) => (DEVICE_BUSY_STATUSES as readonly string[]).includes(j.status) && j.status !== "rolling_back");
  for (const job of jobs.filter((j) => !j.dispatchedAt)) {
    // Dry runs never change the system, so they're allowed while paused; execution and rollback are not.
    if (job.status === "planning") messages.push(dispatchMessage(job, "dry_run"));
    else if (job.status === "queued" && !paused && !busy) messages.push(dispatchMessage(job, "execute", await completedStepIds(job.id)));
    else if (job.status === "rolling_back" && !paused) messages.push({ type: "rollback.request", jobId: job.id });
    else continue;
    await db.update(executionJobs).set({ dispatchedAt: new Date() }).where(eq(executionJobs.id, job.id));
    if (job.status === "queued") break; // one execution at a time per device
  }
  return messages;
}

function dispatchMessage(job: ExecutionJob, mode: "dry_run" | "execute", completed: string[] = []): ServerMessage {
  return DispatchSchema.parse({
    type: "job.dispatch",
    jobId: job.id,
    mode,
    specRevision: job.specRevision,
    spec: job.spec,
    approvedStepIds: mode === "execute" ? job.approvedStepIds : [],
    completedStepIds: completed,
  });
}

async function completedStepIds(jobId: string): Promise<string[]> {
  const rows = await db.select({ stepId: executionSteps.stepId, status: executionSteps.status }).from(executionSteps).where(eq(executionSteps.jobId, jobId));
  return rows.filter((r) => r.status === "done" || r.status === "skipped").map((r) => r.stepId);
}

/** IDOR guard: the job must belong to this device AND this device's user. */
async function ownedJob(device: Device, jobId: string): Promise<ExecutionJob> {
  const [job] = await db
    .select()
    .from(executionJobs)
    .where(and(eq(executionJobs.id, jobId), eq(executionJobs.deviceId, device.id), eq(executionJobs.userId, device.userId)));
  if (!job) throw new HttpError(404, "Unknown job");
  return job;
}

export async function handleAgentEvent(device: Device, event: AgentEvent): Promise<void> {
  switch (event.type) {
    case "agent.hello": {
      await touchDevice(device.id, { agentVersion: event.agentVersion, executorVersion: event.executorVersion, platform: event.platform, arch: event.arch, osVersion: event.osVersion });
      // Redeliver anything unfinished on reconnect.
      await db
        .update(executionJobs)
        .set({ dispatchedAt: null })
        .where(and(eq(executionJobs.deviceId, device.id), inArray(executionJobs.status, ["planning", "queued", "rolling_back"]), isNull(executionJobs.completedAt)));
      return;
    }
    case "agent.heartbeat":
      await touchDevice(device.id);
      return;
    case "job.ack": {
      const job = await ownedJob(device, event.jobId);
      await db
        .update(executionJobs)
        .set({ agentVersion: device.agentVersion, executorVersion: device.executorVersion, os: device.osVersion, arch: device.arch })
        .where(eq(executionJobs.id, job.id));
      await appendEvent(job.id, "job_ack", { mode: event.mode, agentVersion: device.agentVersion });
      return;
    }
    case "job.planned": {
      const job = await ownedJob(device, event.jobId);
      if (job.status !== "planning") return; // late/duplicate dry run
      const plan = event.plan.map((p) => ({ ...p, command: p.command && redactSecrets(p.command), diffPreview: p.diffPreview && redactSecrets(p.diffPreview) }));
      await recordPlan(job, plan, device.autoRunLow);
      return;
    }
    case "job.started": {
      const job = await ownedJob(device, event.jobId);
      if (job.status === "queued") await transition(job, "executing", "execution_started", {}, { startedAt: job.startedAt ?? new Date() });
      return;
    }
    case "job.step": {
      const job = await ownedJob(device, event.jobId);
      const result = { ...event.result, output: event.result.output && redactSecrets(event.result.output) };
      await recordStepResult(job, result);
      return;
    }
    case "job.verifying": {
      const job = await ownedJob(device, event.jobId);
      if (job.status === "executing") await transition(job, "verifying", "verifying");
      return;
    }
    case "job.needs_user": {
      const job = await ownedJob(device, event.jobId);
      if (job.status !== "executing") return;
      await transition(job, "needs_user_action", "user_action_required", { stepId: event.stepId });
      await notify({
        userId: job.userId,
        kind: "user_action",
        title: failureMessage("USER_ACTION_REQUIRED"),
        body: job.itemTitle,
        itemId: job.itemId,
        jobId: job.id,
        dedupeKey: `user-action:${job.id}:${event.stepId}`,
        critical: true,
      });
      return;
    }
    case "job.completed": {
      const job = await ownedJob(device, event.jobId);
      if (job.status === "executing" || job.status === "verifying") await completeJob(job);
      return;
    }
    case "job.failed": {
      const job = await ownedJob(device, event.jobId);
      if (["planning", "queued", "executing", "verifying"].includes(job.status)) {
        await failJob(job, event.code, redactSecrets(event.detail), event.rolledBack);
      } else if (job.status === "rolling_back") {
        await finishRollback(job, false, redactSecrets(event.detail));
      }
      return;
    }
    case "rollback.started": {
      const job = await ownedJob(device, event.jobId);
      if (job.status === "failed" || job.status === "done") await transition(job, "rolling_back", "rollback_started");
      else await appendEvent(job.id, "rollback_started");
      return;
    }
    case "rollback.completed": {
      const job = await ownedJob(device, event.jobId);
      if (job.status === "rolling_back") await finishRollback(job, event.ok, redactSecrets(event.detail));
      else await appendEvent(job.id, event.ok ? "rollback_completed" : "rollback_failed", { detail: redactSecrets(event.detail).slice(0, 500) });
      return;
    }
    default:
      log.warn("agent.unknown_event", { deviceId: device.id });
  }
}
