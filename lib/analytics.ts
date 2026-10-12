import "server-only";
import { productEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";

export type ProductEventName =
  | "item_saved"
  | "item_analyzed"
  | "action_detected"
  | "setup_reviewed"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "rollback_used"
  | "usage_confirmed"
  | "applied_marked";

/** Names, ids and small enums only — never content, commands or secrets. */
export async function track(
  userId: string,
  name: ProductEventName,
  opts: { itemId?: string | null; props?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  try {
    await db.insert(productEvents).values({ userId, name, itemId: opts.itemId ?? null, props: opts.props ?? {} });
  } catch (error) {
    log.warn("analytics.write_failed", { name, error: errorMessage(error) });
  }
}
