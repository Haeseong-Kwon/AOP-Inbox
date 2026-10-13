import {
  evaluateSpec,
  redactSecrets,
  SetupSpecSchema,
  type AgentEvent,
  type Dispatch,
  type PlannedAction,
  type ServerMessage,
  type SetupSpec,
  type SetupStep,
  type StepPolicy,
  type StepResult,
} from "@aop-inbox/core";
import type { AgentConfig } from "./config";
import { sanitizedEnv, STEP_TIMEOUT_MS } from "./exec";
import { executorFor } from "./executors";
import { StepError, type ExecutionContext, type Executor } from "./executors/types";
import type { Ledger } from "./ledger";
import { pathContext, type AgentPaths } from "./paths";
import { runRecipe } from "./recipes";
import { SnapshotError, SnapshotStore } from "./snapshot";

/**
 * Executes dispatched jobs on this Mac. It trusts nothing from the network:
 * the spec is re-validated, the policy re-evaluated against the real
 * filesystem, approvals enforced locally, one job at a time.
 *
 * Extract → Structure → Validate → Policy → Dry Run → Approve → Snapshot → Execute → Verify → Record
 *                         (server)      (here, again)              ↑ only these run here ↑
 */

export interface RunnerDeps {
  paths: AgentPaths;
  config: () => AgentConfig;
  ledger: Ledger;
  emit: (event: AgentEvent) => Promise<void>;
  claudeBin?: string;
  timeoutMs?: number;
}

type Work = { kind: "execute"; dispatch: Dispatch } | { kind: "rollback"; jobId: string };

export class JobRunner {
  private queue: Work[] = [];
  private busy = false;
  private serverPaused = false;
  private serverAutoRunLow = false;
  activeJobId: string | null = null;
  latestAgentVersion: string | null = null;

  constructor(private deps: RunnerDeps) {}

  get paused(): boolean {
    return this.serverPaused || this.deps.config().paused;
  }

  private context(jobId: string, signal?: AbortSignal): ExecutionContext {
    const config = this.deps.config();
    return {
      jobId,
      paths: pathContext(this.deps.paths, config.extraWorkspaces),
      workspace: this.deps.paths.workspace,
      env: sanitizedEnv(this.deps.paths.home),
      snapshots: new SnapshotStore(this.deps.paths.snapshotsDir, this.deps.ledger),
      config,
      timeoutMs: this.deps.timeoutMs ?? STEP_TIMEOUT_MS,
      signal,
      claudeBin: this.deps.claudeBin ?? "claude",
    };
  }

  /** Both the person's local consent and the dashboard setting are required for low-risk auto-run. */
  private policyFor(spec: SetupSpec) {
    const config = this.deps.config();
    return evaluateSpec(spec, { autoRunLow: config.autoRunLow && this.serverAutoRunLow, paths: pathContext(this.deps.paths, config.extraWorkspaces) });
  }

  /** Paths leave the Mac home-relative (~/…): readable, and no username sent to the server. */
  private tilde = (p: string) => (p.startsWith(this.deps.paths.home + "/") ? `~${p.slice(this.deps.paths.home.length)}` : p);

  private emit(event: AgentEvent): Promise<void> {
    if (event.type === "job.step") {
      return this.deps.emit({ ...event, result: { ...event.result, changedFiles: event.result.changedFiles.map((f) => ({ ...f, path: this.tilde(f.path) })) } });
    }
    if (event.type === "job.planned") return this.deps.emit({ ...event, plan: event.plan.map((a) => ({ ...a, path: a.path && this.tilde(a.path) })) });
    return this.deps.emit(event);
  }

  private log(jobId: string | null, level: "info" | "warn" | "error", message: string) {
    this.deps.ledger.log(jobId, level, redactSecrets(message));
  }

  async handle(message: ServerMessage): Promise<void> {
    if (message.type === "agent.config") {
      this.serverPaused = message.paused;
      this.serverAutoRunLow = message.autoRunLow;
      this.latestAgentVersion = message.latestAgentVersion ?? null;
      await this.drain();
      return;
    }
    if (message.type === "rollback.request") {
      this.enqueue({ kind: "rollback", jobId: message.jobId });
      await this.drain();
      return;
    }
    const known = this.deps.ledger.job(message.jobId);
    if (message.mode === "dry_run") {
      if (known?.mode === "dry_run" && known.status === "planned") return; // duplicate delivery
      await this.dryRun(message);
      return;
    }
    if (known && known.mode === "execute" && ["done", "failed", "executing"].includes(known.status)) return;
    this.enqueue({ kind: "execute", dispatch: message });
    await this.drain();
  }

  private enqueue(work: Work) {
    const id = work.kind === "execute" ? work.dispatch.jobId : work.jobId;
    if (!this.queue.some((w) => (w.kind === "execute" ? w.dispatch.jobId : w.jobId) === id && w.kind === work.kind)) this.queue.push(work);
  }

  /** One job at a time; paused agents keep work queued instead of running it. */
  async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.paused) {
        const work = this.queue.shift()!;
        if (work.kind === "execute") await this.execute(work.dispatch);
        else await this.undo(work.jobId);
      }
    } finally {
      this.busy = false;
    }
  }

  private validate(dispatch: Dispatch): SetupSpec | null {
    const parsed = SetupSpecSchema.safeParse(dispatch.spec);
    return parsed.success ? parsed.data : null;
  }

  async dryRun(dispatch: Dispatch): Promise<PlannedAction[] | null> {
    const { jobId } = dispatch;
    await this.emit({ type: "job.ack", jobId, mode: "dry_run" });
    const spec = this.validate(dispatch);
    if (!spec) {
      await this.emit({ type: "job.failed", jobId, code: "SPEC_INVALID", detail: "The setup plan didn't pass validation on this Mac.", rolledBack: false });
      return null;
    }
    this.deps.ledger.upsertJob(jobId, "dry_run", "planning", dispatch.specRevision, JSON.stringify(spec));
    const policy = this.policyFor(spec);
    if (policy.decision === "blocked") {
      this.deps.ledger.setJobStatus(jobId, "failed");
      await this.emit({ type: "job.failed", jobId, code: "POLICY_DENIED", detail: policy.blockedReasons.slice(0, 5).join("\n"), rolledBack: false });
      return null;
    }
    const ctx = this.context(jobId);
    const plan: PlannedAction[] = [];
    for (const step of spec.steps) {
      const decision = policy.steps.find((s) => s.stepId === step.id)!;
      if (decision.decision === "manual") {
        plan.push({ stepId: step.id, type: "user_action", description: step.instruction, reversible: "no" });
        continue;
      }
      const executor = executorFor(step, ctx);
      if (!executor) {
        plan.push({ stepId: step.id, type: "user_action", description: `No executor for this step — do it manually: ${step.instruction}`, reversible: "no" });
        continue;
      }
      try {
        // Read-only pre-check: already in the desired state?
        if (step.verify && (await runRecipe(step.verify.recipe, step.verify.args, ctx)).ok) {
          plan.push({ stepId: step.id, type: "skip", description: `Already configured — ${step.title}`, reversible: "yes" });
          continue;
        }
        plan.push(...(await executor.dryRun(step, ctx)));
      } catch (error) {
        const code = error instanceof StepError ? error.code : "EXEC_COMMAND_FAILED";
        this.deps.ledger.setJobStatus(jobId, "failed");
        await this.emit({ type: "job.failed", jobId, code, detail: redactSecrets((error as Error).message), rolledBack: false });
        return null;
      }
    }
    this.deps.ledger.setJobStatus(jobId, "planned");
    await this.emit({ type: "job.planned", jobId, plan });
    return plan;
  }

  private approved(step: SetupStep, policy: StepPolicy, dispatch: Dispatch): boolean {
    if (policy.decision === "auto") return true; // only reachable with both auto-run consents on
    if (policy.decision === "approve") return dispatch.approvedStepIds.includes(step.id);
    return false;
  }

  async execute(dispatch: Dispatch): Promise<void> {
    const { jobId } = dispatch;
    this.activeJobId = jobId;
    try {
      await this.emit({ type: "job.ack", jobId, mode: "execute" });
      const spec = this.validate(dispatch);
      if (!spec) {
        await this.emit({ type: "job.failed", jobId, code: "SPEC_INVALID", detail: "The setup plan didn't pass validation on this Mac.", rolledBack: false });
        return;
      }
      this.deps.ledger.upsertJob(jobId, "execute", "executing", dispatch.specRevision, JSON.stringify(spec));
      const policy = this.policyFor(spec);
      if (policy.decision === "blocked") {
        this.deps.ledger.setJobStatus(jobId, "failed");
        await this.emit({ type: "job.failed", jobId, code: "POLICY_DENIED", detail: policy.blockedReasons.slice(0, 5).join("\n"), rolledBack: false });
        return;
      }
      // Every step that will run must be approved now, on this Mac's view of the policy.
      const pending = spec.steps.filter((s) => !dispatch.completedStepIds.includes(s.id));
      for (const step of pending) {
        const p = policy.steps.find((x) => x.stepId === step.id)!;
        if (p.decision !== "manual" && !this.approved(step, p, dispatch)) {
          this.deps.ledger.setJobStatus(jobId, "failed");
          await this.emit({ type: "job.failed", jobId, code: "POLICY_DENIED", detail: `“${step.title}” wasn't approved for this run.`, rolledBack: false });
          return;
        }
      }

      await this.emit({ type: "job.started", jobId });
      const ctx = this.context(jobId);
      const executed: { step: SetupStep; executor: Executor }[] = [];

      for (const step of pending) {
        const p = policy.steps.find((x) => x.stepId === step.id)!;
        const executor = p.decision === "manual" ? null : executorFor(step, ctx);
        if (!executor || p.decision === "manual") {
          const result: StepResult = { stepId: step.id, outcome: "needs_user", summary: step.instruction, changedFiles: [], installed: [], snapshotIds: [], reversible: "no" };
          this.deps.ledger.recordStep(jobId, step.id, "needs_user", JSON.stringify(result));
          this.deps.ledger.setJobStatus(jobId, "needs_user");
          await this.emit({ type: "job.step", jobId, result });
          await this.emit({ type: "job.needs_user", jobId, stepId: step.id });
          return;
        }

        let result: StepResult;
        try {
          // Idempotency: already in the desired state → record and move on, change nothing.
          if (step.verify) {
            const pre = await runRecipe(step.verify.recipe, step.verify.args, ctx);
            if (pre.ok) {
              result = { stepId: step.id, outcome: "skipped", summary: `Already configured — ${pre.detail}`, changedFiles: [], installed: [], snapshotIds: [], reversible: "yes", verify: pre };
              this.deps.ledger.recordStep(jobId, step.id, "skipped", JSON.stringify(result));
              await this.emit({ type: "job.step", jobId, result });
              continue;
            }
          }
          this.log(jobId, "info", `Running step ${step.id} with ${executor.id}`);
          // Registered before running: a step that fails half-way is rolled back too.
          executed.push({ step, executor });
          result = await executor.run(step, ctx);
          if (result.outcome === "needs_user") {
            this.deps.ledger.recordStep(jobId, step.id, "needs_user", JSON.stringify(result));
            this.deps.ledger.setJobStatus(jobId, "needs_user");
            await this.emit({ type: "job.step", jobId, result });
            await this.emit({ type: "job.needs_user", jobId, stepId: step.id });
            return;
          }
          // Exit code 0 isn't success: the result must be observable.
          const verify = await executor.verify(step, ctx);
          if (verify) result = { ...result, verify };
          if (verify && !verify.ok) throw new StepError("VERIFY_FAILED", verify.detail);
        } catch (error) {
          const code = error instanceof StepError ? error.code : error instanceof SnapshotError ? "POLICY_DENIED" : "EXEC_COMMAND_FAILED";
          const detail = redactSecrets((error as Error).message);
          this.log(jobId, "error", `Step ${step.id} failed: ${detail}`);
          this.deps.ledger.recordStep(jobId, step.id, "failed", JSON.stringify({ stepId: step.id, detail }));
          await this.emit({
            type: "job.step",
            jobId,
            result: { stepId: step.id, outcome: "failed", summary: detail.slice(0, 400), changedFiles: [], installed: [], snapshotIds: [], reversible: "no" },
          });
          const rolledBack = await this.rollbackExecuted(jobId, executed, ctx);
          this.deps.ledger.setJobStatus(jobId, "failed");
          await this.emit({ type: "job.failed", jobId, code, detail, rolledBack });
          return;
        }
        this.deps.ledger.recordStep(jobId, step.id, result.outcome, JSON.stringify(result));
        await this.emit({ type: "job.step", jobId, result });
      }

      await this.emit({ type: "job.verifying", jobId });
      this.deps.ledger.setJobStatus(jobId, "done");
      await this.emit({ type: "job.completed", jobId });
    } finally {
      this.activeJobId = null;
    }
  }

  /** Undo, newest first. Returns true only if every executed step was restored. */
  private async rollbackExecuted(jobId: string, executed: { step: SetupStep; executor: Executor }[], ctx: ExecutionContext): Promise<boolean> {
    let ok = true;
    for (const { step, executor } of [...executed].reverse()) {
      try {
        const detail = executor.rollback ? await executor.rollback(step, this.deps.ledger.snapshots(jobId, step.id), ctx) : "Nothing to undo";
        this.deps.ledger.recordStep(jobId, step.id, "rolled_back", JSON.stringify({ stepId: step.id, detail }));
        this.log(jobId, "info", `Rolled back ${step.id}: ${detail}`);
      } catch (error) {
        ok = false;
        this.log(jobId, "error", `Rollback of ${step.id} failed: ${(error as Error).message}`);
      }
    }
    return ok;
  }

  /** User-requested Undo of a finished job, from the local ledger (works offline too). */
  async undo(jobId: string): Promise<{ ok: boolean; detail: string }> {
    await this.emit({ type: "rollback.started", jobId });
    const job = this.deps.ledger.job(jobId);
    if (!job) {
      const detail = "This Mac has no record of that setup, so nothing was changed.";
      await this.emit({ type: "rollback.completed", jobId, ok: false, detail });
      return { ok: false, detail };
    }
    const spec = SetupSpecSchema.parse(JSON.parse(job.specJson));
    const ctx = this.context(jobId);
    const done = new Set(this.deps.ledger.steps(jobId).filter((s) => s.outcome === "done").map((s) => s.stepId));
    const executed = spec.steps.filter((s) => done.has(s.id)).map((step) => ({ step, executor: executorFor(step, ctx)! })).filter((x) => x.executor);
    const details: string[] = [];
    let ok = true;
    for (const { step, executor } of executed.reverse()) {
      try {
        details.push(executor.rollback ? await executor.rollback(step, this.deps.ledger.snapshots(jobId, step.id), ctx) : `${step.title}: nothing to undo`);
        this.deps.ledger.recordStep(jobId, step.id, "rolled_back", JSON.stringify({ stepId: step.id }));
      } catch (error) {
        ok = false;
        details.push(`${step.title}: ${(error as Error).message}`);
      }
    }
    this.deps.ledger.setJobStatus(jobId, ok ? "rolled_back" : "rollback_failed");
    const detail = redactSecrets(details.join(" ").slice(0, 1000) || "Nothing needed undoing.");
    await this.emit({ type: "rollback.completed", jobId, ok, detail });
    return { ok, detail };
  }
}
