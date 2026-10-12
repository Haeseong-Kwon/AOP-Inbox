import type { Explain, ExecutionStatus, PlannedAction, Risk, SetupSpec, SpecPolicy, StepResult } from "@aop-inbox/core/browser";

/** DTOs shared by API routes and client components. */

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  arch: string;
  agentVersion: string | null;
  online: boolean;
  lastSeenAt: string | null;
  paused: boolean;
  autoRunLow: boolean;
  updateAvailable: boolean;
}

export interface JobStepView {
  stepId: string;
  title: string;
  status: "pending" | "done" | "skipped" | "failed" | "needs_user" | "rolled_back";
  result: StepResult | null;
}

export interface JobEventView {
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface JobView {
  id: string;
  itemId: string | null;
  itemTitle: string;
  status: ExecutionStatus;
  statusLabel: string;
  risk: Risk;
  specRevision: number;
  plan: PlannedAction[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  expiresAt: string;
  agentVersion: string | null;
  os: string | null;
  arch: string | null;
  steps: JobStepView[];
  events: JobEventView[];
  usageHint: string | null;
}

export interface SetupView {
  itemId: string;
  revision: number;
  createdAt: string;
  model: string;
  spec: SetupSpec;
  policy: SpecPolicy;
  explain: Record<string, Explain>;
  plan: PlannedAction[];
  checklist: string;
  conflicts: { jobId: string; itemTitle: string; targets: string[] }[];
  device: DeviceView | null;
  executionPaused: boolean;
  job: JobView | null;
  history: { id: string; status: ExecutionStatus; statusLabel: string; createdAt: string; completedAt: string | null }[];
}

export interface ActivityEntry {
  jobId: string;
  itemId: string | null;
  itemTitle: string;
  status: ExecutionStatus;
  statusLabel: string;
  risk: Risk;
  createdAt: string;
  completedAt: string | null;
  changed: string[];
  installed: string[];
  verified: number;
  feedback: string | null;
}

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  itemId: string | null;
  jobId: string | null;
  createdAt: string;
  read: boolean;
}

export const FEEDBACK_KINDS = ["used", "useful", "not_using", "rolled_back", "remind_later", "applied"] as const;
