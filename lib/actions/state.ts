import "server-only";
import { desc, eq } from "drizzle-orm";
import { STATUS_LABELS, type ItemActionState } from "@aop-inbox/core";
import { executionJobs, items, setupSpecs } from "@/db/schema";
import { db } from "@/lib/db";

const RUNNING = new Set(["planning", "queued", "executing", "verifying", "rolling_back"]);

/**
 * The one place that derives an item's action state and its searchable action
 * digest from the latest SetupSpec + execution job. Call after any change.
 */
export async function syncItemActionState(itemId: string): Promise<ItemActionState | null> {
  const item = await db.query.items.findFirst({ where: eq(items.id, itemId) });
  if (!item) return null;
  const [spec] = await db.select().from(setupSpecs).where(eq(setupSpecs.itemId, itemId)).orderBy(desc(setupSpecs.revision)).limit(1);
  const jobs = await db
    .select({ status: executionJobs.status, createdAt: executionJobs.createdAt, completedAt: executionJobs.completedAt })
    .from(executionJobs)
    .where(eq(executionJobs.itemId, itemId))
    .orderBy(desc(executionJobs.createdAt))
    .limit(5);
  const latest = jobs[0];

  let state: ItemActionState | null;
  if (latest && latest.status === "awaiting_approval") state = "needs_approval";
  else if (latest && RUNNING.has(latest.status)) state = "running";
  else if (latest && latest.status === "needs_user_action") state = "waiting_user";
  else if (item.appliedAt) state = "applied";
  else if (spec) {
    state = spec.policy.decision === "none" ? (item.contentIntent === "actionable" && item.actionItems.length ? "action_ready" : "knowledge") : spec.policy.decision === "blocked" ? "blocked" : "action_ready";
  } else if (!item.contentIntent || item.contentIntent === "knowledge" || item.contentIntent === "reference") {
    state = item.contentIntent ? "knowledge" : null;
  } else if (item.contentIntent === "actionable") {
    // A hand-done checklist (actionItems) — no SetupSpec needed unless extraction finds commands.
    state = item.actionItems.length ? "action_ready" : "knowledge";
  } else state = "analyzing";

  const digest = spec
    ? [
        spec.spec.summary,
        ...spec.spec.steps.map((s) => `${s.title}. ${s.commands.join(" ")} ${s.mcp ? `${s.mcp.name} MCP` : ""}`),
        spec.spec.usageHint,
        ...jobs.map((j) => `${STATUS_LABELS[j.status]} ${(j.completedAt ?? j.createdAt).toISOString().slice(0, 10)}`),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000)
    : null;

  await db.update(items).set({ actionState: state, actionText: digest }).where(eq(items.id, itemId));
  return state;
}
