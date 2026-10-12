import { after, NextResponse } from "next/server";
import { z } from "zod";
import { drainQueue, reprocessItem } from "@/lib/ingestion/pipeline";
import { getItem } from "@/lib/items/repository";
import { HttpError, withUser } from "@/lib/http";

export const POST = withUser<RouteContext<"/api/items/[id]/reprocess">>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  if (!(await getItem(user.id, id))) throw new HttpError(404, "This item doesn't exist anymore.");
  await reprocessItem(id, "enrich");
  after(() => drainQueue(25_000));
  return NextResponse.json({ ok: true }, { status: 202 });
});
