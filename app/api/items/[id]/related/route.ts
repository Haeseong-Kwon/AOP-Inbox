import { NextResponse } from "next/server";
import { z } from "zod";
import { relatedItems } from "@/lib/search/hybrid";
import { withUser } from "@/lib/http";

export const GET = withUser<RouteContext<"/api/items/[id]/related">>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  return NextResponse.json({ items: await relatedItems(user.id, id) });
});
