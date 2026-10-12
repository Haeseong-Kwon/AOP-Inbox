import type { Executor } from "./types";

/** user_action and anything needing a person: the agent pauses the job and waits. */
export const manualExecutor: Executor = {
  id: "manual",
  supports: (step) => step.type === "user_action" || step.needsUser,
  dryRun: async (step) => [{ stepId: step.id, type: "user_action", description: step.instruction, reversible: "no" }],
  run: async (step) => ({ stepId: step.id, outcome: "needs_user", summary: step.instruction, changedFiles: [], installed: [], snapshotIds: [], reversible: "no" }),
  verify: async () => null,
};
