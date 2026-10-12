import { NextResponse } from "next/server";
import { z } from "zod";
import { setMembership } from "@/lib/collections/repository";
import { HttpError, readJson, withUser } from "@/lib/http";

const bodySchema = z.object({ itemId: z.uuid(), member: z.boolean() });

export const POST = withUser<RouteContext<"/api/collections/[id]/items">>(async (req, user, ctx) => {
  const collectionId = z.uuid().parse((await ctx.params).id);
  const { itemId, member } = await readJson(req, bodySchema, 4_000);
  if (!(await setMembership(user.id, collectionId, itemId, member))) throw new HttpError(404, "Collection or item not found.");
  return NextResponse.json({ ok: true });
});
