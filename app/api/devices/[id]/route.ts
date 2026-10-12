import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeDevice, updateDevice } from "@/lib/execution/devices";
import { HttpError, readJson, withUser } from "@/lib/http";

type Ctx = RouteContext<"/api/devices/[id]">;
const patchSchema = z.object({ paused: z.boolean().optional(), autoRunLow: z.boolean().optional(), name: z.string().trim().min(1).max(80).optional() }).strict();

export const PATCH = withUser<Ctx>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  if (!(await updateDevice(user.id, id, await readJson(req, patchSchema, 4_000)))) throw new HttpError(404, "Device not found.");
  return NextResponse.json({ ok: true });
});

export const DELETE = withUser<Ctx>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  if (!(await revokeDevice(user.id, id))) throw new HttpError(404, "Device not found.");
  return new NextResponse(null, { status: 204 });
});
