import { and, eq, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { items } from "@/db/schema";
import { db } from "@/lib/db";
import { activity } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [applied] = await db
    .select({ week: sql<number>`count(*) filter (where ${items.appliedAt} >= ${weekAgo.toISOString()})::int`, total: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.userId, user.id), isNotNull(items.appliedAt)));
  const appliedItems = await db
    .select({ id: items.id, title: items.aiTitle, appliedAt: items.appliedAt, sourceType: items.sourceType })
    .from(items)
    .where(and(eq(items.userId, user.id), isNotNull(items.appliedAt)))
    .orderBy(sql`${items.appliedAt} desc`)
    .limit(30);
  return NextResponse.json({
    entries: await activity(user.id),
    applied: appliedItems.map((i) => ({ ...i, appliedAt: i.appliedAt?.toISOString() ?? null })),
    stats: { appliedThisWeek: Number(applied?.week ?? 0), appliedTotal: Number(applied?.total ?? 0) },
  });
});
