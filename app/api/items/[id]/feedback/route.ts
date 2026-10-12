import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { executionJobs, items, notifications, usageFeedback } from "@/db/schema";
import { syncItemActionState } from "@/lib/actions/state";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { FEEDBACK_KINDS } from "@/lib/execution/types";
import { remindLater } from "@/lib/followups";
import { HttpError, readJson, withUser } from "@/lib/http";

const schema = z.object({ kind: z.enum(FEEDBACK_KINDS), jobId: z.uuid().optional() }).strict();

/** "Used it" / "Useful" / "Not using it" / "Remind me later" / manual "Mark as applied". */
export const POST = withUser<RouteContext<"/api/items/[id]/feedback">>(async (req, user, ctx) => {
  const itemId = z.uuid().parse((await ctx.params).id);
  const { kind, jobId } = await readJson(req, schema, 2_000);
  const item = await db.query.items.findFirst({ where: and(eq(items.id, itemId), eq(items.userId, user.id)) });
  if (!item) throw new HttpError(404, "This item doesn't exist anymore.");
  const [job] = jobId
    ? await db.select().from(executionJobs).where(and(eq(executionJobs.id, jobId), eq(executionJobs.userId, user.id), eq(executionJobs.itemId, itemId)))
    : await db.select().from(executionJobs).where(and(eq(executionJobs.itemId, itemId), eq(executionJobs.userId, user.id))).orderBy(desc(executionJobs.createdAt)).limit(1);

  if (kind === "remind_later") {
    if (job) await remindLater(job);
  } else {
    await db.insert(usageFeedback).values({ userId: user.id, itemId, jobId: job?.id ?? null, kind });
    if (kind === "applied" || kind === "used" || kind === "useful") {
      await db.update(items).set({ appliedAt: item.appliedAt ?? new Date() }).where(eq(items.id, itemId));
    }
    await track(user.id, kind === "applied" ? "applied_marked" : "usage_confirmed", { itemId, props: { kind } });
  }
  // Any answer closes the open follow-up for this item.
  await db
    .update(notifications)
    .set({ resolvedAt: new Date() })
    .where(and(eq(notifications.itemId, itemId), eq(notifications.userId, user.id)));
  await syncItemActionState(itemId);
  return NextResponse.json({ ok: true });
});
