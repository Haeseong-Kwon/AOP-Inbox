/**
 * Execution lifecycle, in one place. Every status change goes through
 * `assertTransition`, on the server and in the agent ledger.
 *
 *   planning ──▶ awaiting_approval ──▶ queued ──▶ executing ──▶ verifying ──▶ done
 *      │               │                 │           │  ▲            │          │
 *      │               ▼                 ▼           ▼  │            ▼          ▼
 *      └──────▶ cancelled / expired   expired   needs_user_action  failed ─▶ rolling_back ─▶ rolled_back
 */

export const EXECUTION_STATUSES = [
  "planning", // waiting for the device's dry run
  "awaiting_approval",
  "queued", // approved (or low-risk auto-run), waiting for the device
  "executing",
  "needs_user_action",
  "verifying",
  "done",
  "failed",
  "cancelled",
  "expired",
  "rolling_back",
  "rolled_back",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  planning: ["awaiting_approval", "queued", "failed", "cancelled", "expired"],
  awaiting_approval: ["queued", "cancelled", "expired", "planning"],
  queued: ["executing", "cancelled", "expired", "failed"],
  executing: ["verifying", "needs_user_action", "failed", "rolling_back"],
  needs_user_action: ["queued", "cancelled", "rolling_back"],
  verifying: ["done", "failed", "rolling_back"],
  done: ["rolling_back"],
  failed: ["rolling_back", "planning"],
  cancelled: [],
  expired: [],
  rolling_back: ["rolled_back", "failed"],
  rolled_back: ["planning"],
};

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = ["done", "failed", "cancelled", "expired", "rolled_back"];
export const ACTIVE_STATUSES: readonly ExecutionStatus[] = ["planning", "awaiting_approval", "queued", "executing", "needs_user_action", "verifying", "rolling_back"];
/** Statuses during which the device is busy with this job (one at a time per device). */
export const DEVICE_BUSY_STATUSES: readonly ExecutionStatus[] = ["executing", "verifying", "rolling_back"];

export class InvalidTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Invalid execution transition ${from} → ${to}`);
  }
}

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const isExecutionStatus = (s: string): s is ExecutionStatus => (EXECUTION_STATUSES as readonly string[]).includes(s);

/** Item-level action state shown in lists and filters (denormalized on items). */
export const ITEM_ACTION_STATES = ["analyzing", "knowledge", "action_ready", "needs_approval", "running", "waiting_user", "blocked", "applied"] as const;
export type ItemActionState = (typeof ITEM_ACTION_STATES)[number];

export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  planning: "Preparing plan",
  awaiting_approval: "Needs your approval",
  queued: "Waiting for your Mac",
  executing: "Running",
  needs_user_action: "Waiting for you",
  verifying: "Verifying",
  done: "Applied",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  rolling_back: "Undoing",
  rolled_back: "Undone",
};
