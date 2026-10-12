import { z } from "zod";
import { PlannedActionSchema, SetupSpecSchema, StepResultSchema } from "./setup-spec";

/**
 * Gateway ↔ Local Agent protocol. The agent connects OUT to the gateway
 * (SSE down, HTTPS POST up) — nothing listens on the Mac.
 */

export const PROTOCOL_VERSION = 1;
export const HEARTBEAT_MS = 30_000;

/** Server → agent (SSE `data:` payloads). */
export const DispatchSchema = z.object({
  type: z.literal("job.dispatch"),
  jobId: z.uuid(),
  mode: z.enum(["dry_run", "execute"]),
  specRevision: z.number().int().positive(),
  spec: SetupSpecSchema,
  /** step ids the user approved (execute mode). Agent refuses unapproved non-auto steps. */
  approvedStepIds: z.array(z.string()).default([]),
  /** steps already finished in an earlier run of this job (resume after needs_user_action) */
  completedStepIds: z.array(z.string()).default([]),
});
export const RollbackRequestSchema = z.object({ type: z.literal("rollback.request"), jobId: z.uuid() });
export const AgentConfigSchema = z.object({
  type: z.literal("agent.config"),
  paused: z.boolean(),
  autoRunLow: z.boolean(),
  latestAgentVersion: z.string().optional(),
});
export const ServerMessageSchema = z.discriminatedUnion("type", [DispatchSchema, RollbackRequestSchema, AgentConfigSchema]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type Dispatch = z.infer<typeof DispatchSchema>;

/** Agent → server (POST /api/agent/events). */
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent.hello"),
    agentVersion: z.string().max(40),
    executorVersion: z.string().max(40),
    platform: z.string().max(20),
    arch: z.string().max(20),
    osVersion: z.string().max(60),
    paused: z.boolean(),
  }),
  z.object({ type: z.literal("agent.heartbeat"), paused: z.boolean(), activeJobId: z.uuid().nullable() }),
  z.object({ type: z.literal("job.ack"), jobId: z.uuid(), mode: z.enum(["dry_run", "execute"]) }),
  z.object({ type: z.literal("job.planned"), jobId: z.uuid(), plan: z.array(PlannedActionSchema).max(100) }),
  z.object({ type: z.literal("job.started"), jobId: z.uuid() }),
  z.object({ type: z.literal("job.step"), jobId: z.uuid(), result: StepResultSchema }),
  z.object({ type: z.literal("job.verifying"), jobId: z.uuid() }),
  z.object({ type: z.literal("job.needs_user"), jobId: z.uuid(), stepId: z.string() }),
  z.object({ type: z.literal("job.completed"), jobId: z.uuid() }),
  z.object({
    type: z.literal("job.failed"),
    jobId: z.uuid(),
    code: z.string().max(40),
    detail: z.string().max(1000),
    rolledBack: z.boolean(),
  }),
  z.object({ type: z.literal("rollback.started"), jobId: z.uuid() }),
  z.object({ type: z.literal("rollback.completed"), jobId: z.uuid(), ok: z.boolean(), detail: z.string().max(1000) }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const PairRequestSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{6}-?[A-Z0-9]{6}$/i),
  name: z.string().min(1).max(80),
  platform: z.string().max(20),
  arch: z.string().max(20),
  agentVersion: z.string().max(40),
});
