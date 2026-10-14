import { NextResponse } from "next/server";
import { collectionTree } from "@/lib/collections/repository";
import { notificationsFor } from "@/lib/execution/views";
import { homeStats, listItems } from "@/lib/items/repository";
import { withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => {
  const base = { cursor: 0, sort: "recent" as const };
  const [stats, recent, unread, highValue, continueReading, collections, ready, waiting, applied, notifications] = await Promise.all([
    homeStats(user.id),
    listItems(user.id, { ...base, limit: 9 }), // fills the 9-slot hotbar
    listItems(user.id, { ...base, state: "unread", limit: 5 }),
    listItems(user.id, { ...base, state: "high-value", sort: "importance", limit: 4 }),
    listItems(user.id, { ...base, state: "read", sort: "viewed", limit: 3 }),
    collectionTree(user.id),
    listItems(user.id, { ...base, state: "ready", limit: 4 }),
    listItems(user.id, { ...base, state: "waiting", limit: 4 }),
    listItems(user.id, { ...base, state: "applied", limit: 4 }),
    notificationsFor(user.id),
  ]);
  return NextResponse.json({
    stats,
    recent: recent.items,
    unread: unread.items,
    highValue: highValue.items,
    continueReading: continueReading.items,
    collections: [...collections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    readyToApply: ready.items,
    waitingForYou: waiting.items,
    recentlyApplied: [...applied.items].sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? "")),
    // Home lists only what waits on the person; results live in the bell.
    notifications: notifications.filter((n) => n.kind !== "execution_result").slice(0, 5),
  });
});
