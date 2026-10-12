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

export const DELETE = withUser<Ctx>(async (_req, user, ctx) => {
  if (!(await deleteItem(user.id, await idOf(ctx)))) throw new HttpError(404, "This item doesn't exist anymore.");
  return new NextResponse(null, { status: 204 });
});
