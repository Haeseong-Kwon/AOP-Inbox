import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics";
import { setupView } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

export const GET = withUser<RouteContext<"/api/items/[id]/setup">>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const view = await setupView(user.id, id);
  if (view && new URL(req.url).searchParams.get("review") === "1") await track(user.id, "setup_reviewed", { itemId: id });
  return NextResponse.json({ setup: view });
});
