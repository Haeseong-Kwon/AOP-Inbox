import { after, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { items } from "@/db/schema";
import { enqueueActionExtraction } from "@/lib/actions/pipeline";
import { db } from "@/lib/db";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { HttpError, readJson, withUser } from "@/lib/http";

const schema = z.object({ input: z.string().trim().min(1).max(20_000) }).strict();

/** Attach a creator guide (link or pasted text) to an item; the item's setup is re-derived with it as evidence. */
export const POST = withUser<RouteContext<"/api/items/[id]/guide">>(async (req, user, ctx) => {
  const parentId = z.uuid().parse((await ctx.params).id);
  const parent = await db.query.items.findFirst({ where: and(eq(items.id, parentId), eq(items.userId, user.id)) });
  if (!parent) throw new HttpError(404, "This item doesn't exist anymore.");
  const { input } = await readJson(req, schema, 64_000);
  const { itemId } = await captureItem(user.id, { input });
  if (itemId === parentId) throw new HttpError(400, "That's the same item.");
  // Pasted text is the guide itself; a link's text arrives after enrichment, then re-triggers extraction.
  await db
    .update(items)
    .set({ parentItemId: parentId, contentText: parseIsNote(input) ? input : undefined })
    .where(and(eq(items.id, itemId), eq(items.userId, user.id)));
  await enqueueActionExtraction(parentId);
  after(() => drainQueue(25_000));
  return NextResponse.json({ guideItemId: itemId }, { status: 201 });
});

function parseIsNote(input: string): boolean {
  return !/^https?:\/\//i.test(input.trim());
}
