import { after, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueActionExtraction } from "@/lib/actions/pipeline";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { HttpError, withUser } from "@/lib/http";

/** "Check for actions" — runs the action extraction for any item, including ones analyzed before the action layer. */
export const POST = withUser<RouteContext<"/api/items/[id]/actions/analyze">>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const [row] = await db.update(items).set({ actionState: "analyzing" }).where(and(eq(items.id, id), eq(items.userId, user.id))).returning({ id: items.id });
  if (!row) throw new HttpError(404, "This item doesn't exist anymore.");
  await enqueueActionExtraction(id);
  after(() => drainQueue(25_000));
  return NextResponse.json({ ok: true }, { status: 202 });
});
