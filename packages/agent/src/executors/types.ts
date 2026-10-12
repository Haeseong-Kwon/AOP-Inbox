import type { PathContext, PlannedAction, SetupStep, StepResult, VerifyResult } from "@aop-inbox/core";
import type { AgentConfig } from "../config";
import type { ChildEnv } from "../exec";
import type { SnapshotRecord } from "../ledger";
import type { SnapshotStore } from "../snapshot";

export interface ExecutionContext {
  jobId: string;
  paths: PathContext;
  workspace: string;
  env: ChildEnv;
  snapshots: SnapshotStore;
  config: AgentConfig;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Override for tests: which `claude` binary to call. */
  claudeBin: string;
}

export interface Executor {
  id: string;
  supports(step: SetupStep, ctx: ExecutionContext): boolean;
  /** Must not change the system. May run read-only probes. */
  dryRun(step: SetupStep, ctx: ExecutionContext): Promise<PlannedAction[]>;
  run(step: SetupStep, ctx: ExecutionContext): Promise<StepResult>;
  verify(step: SetupStep, ctx: ExecutionContext): Promise<VerifyResult | null>;
  rollback?(step: SetupStep, snapshots: SnapshotRecord[], ctx: ExecutionContext): Promise<string>;
}

/** Thrown with a failure code from @aop-inbox/core FAILURE_MESSAGES. */
export class StepError extends Error {
  constructor(public code: "EXEC_COMMAND_FAILED" | "EXEC_TIMEOUT" | "POLICY_DENIED" | "VERIFY_FAILED" | "SPEC_INVALID", message: string) {
    super(message);
  }
}
