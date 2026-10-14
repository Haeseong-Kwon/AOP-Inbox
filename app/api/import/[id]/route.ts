import { NextResponse } from "next/server";
import { z } from "zod";
import { undoImport } from "@/lib/import/service";
import { withUser } from "@/lib/http";

type Ctx = RouteContext<"/api/import/[id]">;

/** Removes the untouched items of one import. */
export const DELETE = withUser<Ctx>(async (_req, user, ctx) => {
  const removed = await undoImport(user.id, z.uuid().parse((await ctx.params).id));
  return NextResponse.json({ removed });
});
