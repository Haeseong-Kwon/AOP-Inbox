import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { user as userTable } from "@/db/schema";
import { db } from "@/lib/db";
import { withUser } from "@/lib/http";

export const POST = withUser(async (_req, user) => {
  await db.update(userTable).set({ onboardedAt: new Date() }).where(eq(userTable.id, user.id));
  return NextResponse.json({ ok: true });
});
