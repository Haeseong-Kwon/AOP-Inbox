import { after, NextResponse } from "next/server";
import { z } from "zod";
import { drainQueue, reprocessItem } from "@/lib/ingestion/pipeline";
import { deleteItem, getItem, updateItem } from "@/lib/items/repository";
import { updateItemSchema } from "@/lib/items/types";
import { HttpError, readJson, withUser } from "@/lib/http";

type Ctx = RouteContext<"/api/items/[id]">;
const idOf = async (ctx: Ctx) => z.uuid().parse((await ctx.params).id);

export const GET = withUser<Ctx>(async (_req, user, ctx) => {
  const item = await getItem(user.id, await idOf(ctx));
  if (!item) throw new HttpError(404, "This item doesn't exist anymore.");
  // Items analyzed before the action layer existed get their intent lazily, once, when opened.
  if (!item.contentIntent && item.processingStatus === "completed") {
    await reprocessItem(item.id, "analyze");
    after(() => drainQueue(25_000));
  }
  return NextResponse.json(item);
});

export const PATCH = withUser<Ctx>(async (req, user, ctx) => {
  const id = await idOf(ctx);
  const result = await updateItem(user.id, id, await readJson(req, updateItemSchema, 64_000));
  if (!result) throw new HttpError(404, "This item doesn't exist anymore.");
  // The note is the strongest signal we have — refresh the AI card and embedding when it changes.
  if (result.noteChanged) {
    await reprocessItem(id);
    after(() => drainQueue(25_000));
  }
  return NextResponse.json(await getItem(user.id, id));
});

export const DELETE = withUser<Ctx>(async (req, user, ctx) => {
  // Summary, embedding, tags, setup specs, notifications and feedback go with the item (FK cascade).
  // The execution ledger is kept (item link set to null, title preserved) unless the person asks to purge it.
  const purgeHistory = new URL(req.url).searchParams.get("purgeHistory") === "1";
  if (!(await deleteItem(user.id, await idOf(ctx), { purgeHistory }))) throw new HttpError(404, "This item doesn't exist anymore.");
  return new NextResponse(null, { status: 204 });
});
