import type { SetupStep } from "@aop-inbox/core";
import { claudeCodeExecutor } from "./claude-code";
import { fileExecutor } from "./file";
import { manualExecutor } from "./manual";
import { shellExecutor } from "./shell";
import type { ExecutionContext, Executor } from "./types";

// Order matters: the first executor that supports a step handles it. Manual first — a person-step is never automated.
export const EXECUTORS: Executor[] = [manualExecutor, claudeCodeExecutor, fileExecutor, shellExecutor];

export function executorFor(step: SetupStep, ctx: ExecutionContext): Executor | null {
  return EXECUTORS.find((e) => e.supports(step, ctx)) ?? null;
}
