import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeCaptureToken } from "@/lib/capture-tokens";
import { HttpError } from "@/lib/errors";
import { withUser } from "@/lib/http";

export const DELETE = withUser<RouteContext<"/api/capture-tokens/[id]">>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  if (!(await revokeCaptureToken(user.id, id))) throw new HttpError(404, "Token not found.");
  return new NextResponse(null, { status: 204 });
});
