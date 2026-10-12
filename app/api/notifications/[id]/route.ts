import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { notifications } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError, readJson, withUser } from "@/lib/http";

const schema = z.object({ read: z.literal(true).optional(), resolved: z.literal(true).optional() }).strict();

export const PATCH = withUser<RouteContext<"/api/notifications/[id]">>(async (req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const body = await readJson(req, schema, 1_000);
  const rows = await db
    .update(notifications)
    .set({ ...(body.read ? { readAt: new Date() } : {}), ...(body.resolved ? { resolvedAt: new Date() } : {}) })
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
    .returning({ id: notifications.id });
  if (rows.length === 0) throw new HttpError(404, "Notification not found.");
  return NextResponse.json({ ok: true });
});
