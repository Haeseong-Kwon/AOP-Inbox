import "server-only";
import { and, asc, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { collectionItems, collections, items, type Item } from "@/db/schema";
import { db } from "@/lib/db";
import type { ItemDetail, ItemPage, ItemSummary, ListQuery, UpdateItemRequest } from "./types";

const HIGH_VALUE_THRESHOLD = 0.7;

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function displayTitle(item: Pick<Item, "aiTitle" | "originalTitle" | "sourceType" | "contentKind" | "canonicalUrl" | "userNote">): string {
  if (item.aiTitle) return item.aiTitle;
  if (item.originalTitle) return item.originalTitle;
  if (item.sourceType === "note" && item.userNote) return item.userNote.split("\n")[0].slice(0, 80);
  if (item.sourceType === "instagram") return `Instagram ${item.contentKind === "post" ? "post" : "Reel"}`;
  return domainOf(item.canonicalUrl) ?? "Untitled";
}

// Tags / primary collection are folded into the row to avoid N+1 queries.
const tagsSql = sql<string[]>`array(
  select t.name from item_tags it join tags t on t.id = it.tag_id where it.item_id = "items"."id" order by t.name limit 4)`;
const actionCountSql = sql<number>`coalesce((
  select jsonb_array_length(s.spec->'steps') from setup_specs s where s.item_id = "items"."id" order by s.revision desc limit 1), 0)::int`;
const collectionSql = sql<string | null>`(
  select c.name from collection_items ci join collections c on c.id = ci.collection_id
  where ci.item_id = "items"."id" order by (c.parent_id is null), c.created_at limit 1)`;

type Row = Item & { tags: string[]; collection: string | null; actionCount: number };

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A summary that only restates the user's note adds nothing — drop it. */
function usefulSummary(row: Pick<Item, "summary" | "userNote" | "description" | "sourceType">): string | null {
  const summary = row.summary ?? (row.sourceType === "note" ? null : row.description);
  if (!summary || !row.userNote) return summary;
  const s = squash(summary.replace(/…$/, ""));
  return squash(row.userNote).includes(s) ? null : summary;
}

export function toSummary(row: Row): ItemSummary {
  return {
    id: row.id,
    sourceType: row.sourceType,
    contentKind: row.contentKind,
    title: displayTitle(row),
    summary: usefulSummary(row),
    thumbnailUrl: row.thumbnailUrl,
    creatorName: row.creatorName,
    domain: domainOf(row.canonicalUrl),
    sourceUrl: row.sourceUrl,
    status: row.status,
    favorite: row.favorite,
    actionable: row.actionable,
    importanceScore: row.importanceScore,
    processingStatus: row.processingStatus,
    processingError: row.processingError,
    savedAt: row.savedAt.toISOString(),
    tags: row.tags ?? [],
    collection: row.collection ?? null,
    contentIntent: row.contentIntent,
    actionState: row.actionState,
    actionCount: Number(row.actionCount ?? 0),
    appliedAt: row.appliedAt?.toISOString() ?? null,
  };
}

function selectRows() {
  return db.select({ item: items, tags: tagsSql, collection: collectionSql, actionCount: actionCountSql }).from(items);
}

const flatten = (r: { item: Item; tags: string[]; collection: string | null; actionCount: number }): Row => ({ ...r.item, tags: r.tags, collection: r.collection, actionCount: r.actionCount });

export async function listItems(userId: string, q: ListQuery): Promise<ItemPage> {
  const where: SQL[] = [eq(items.userId, userId)];
  if (q.source) where.push(eq(items.sourceType, q.source));
  if (q.state === "archived") where.push(eq(items.status, "archived"));
  else {
    where.push(ne(items.status, "archived"));
    if (q.state === "unread" || q.state === "read") where.push(eq(items.status, q.state));
    if (q.state === "favorite") where.push(eq(items.favorite, true));
    if (q.state === "actionable") where.push(sql`(${items.actionable} or ${items.contentIntent} in ('actionable', 'executable', 'requires_user'))`);
    if (q.state === "ready") where.push(eq(items.actionState, "action_ready"));
    if (q.state === "needs-approval") where.push(eq(items.actionState, "needs_approval"));
    if (q.state === "waiting") where.push(sql`${items.actionState} in ('waiting_user', 'needs_approval')`);
    if (q.state === "applied") where.push(sql`${items.appliedAt} is not null`);
    if (q.state === "high-value") where.push(gte(items.importanceScore, HIGH_VALUE_THRESHOLD));
  }
  if (q.collection) {
    where.push(sql`exists (select 1 from collection_items ci join collections c on c.id = ci.collection_id
      where ci.item_id = "items"."id" and (c.id = ${q.collection} or c.parent_id = ${q.collection}))`);
  }
  if (q.intent) where.push(eq(items.contentIntent, q.intent));
  if (q.tag) {
    where.push(sql`exists (select 1 from item_tags it join tags t on t.id = it.tag_id where it.item_id = "items"."id" and t.slug = ${q.tag})`);
  }
  const order = {
    recent: [desc(items.savedAt)],
    oldest: [asc(items.savedAt)],
    importance: [sql`${items.importanceScore} desc nulls last`, desc(items.savedAt)],
    viewed: [sql`${items.lastViewedAt} desc nulls last`, desc(items.savedAt)],
  }[q.sort];

  // ponytail: offset pagination; fine to ~100k items, switch to keyset if it ever drags.
  const rows = await selectRows()
    .where(and(...where))
    .orderBy(...order, desc(items.id))
    .limit(q.limit + 1)
    .offset(q.cursor);
  const page = rows.slice(0, q.limit).map((r) => toSummary(flatten(r)));
  return { items: page, nextCursor: rows.length > q.limit ? q.cursor + q.limit : null };
}

export async function getSummaries(userId: string, ids: string[]): Promise<ItemSummary[]> {
  if (ids.length === 0) return [];
  const rows = await selectRows().where(and(eq(items.userId, userId), inArray(items.id, ids)));
  const byId = new Map(rows.map((r) => [r.item.id, toSummary(flatten(r))]));
  return ids.map((id) => byId.get(id)).filter((x): x is ItemSummary => Boolean(x));
}

export async function getItem(userId: string, id: string): Promise<ItemDetail | null> {
  const [row] = await selectRows().where(and(eq(items.userId, userId), eq(items.id, id)));
  if (!row) return null;
  const cols = await db
    .select({ id: collections.id, name: collections.name, kind: collections.kind })
    .from(collectionItems)
    .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
    .where(eq(collectionItems.itemId, id))
    .orderBy(sql`${collections.parentId} is not null`, collections.name);
  const it = row.item;
  return {
    ...toSummary(flatten(row)),
    canonicalUrl: it.canonicalUrl,
    originalTitle: it.originalTitle,
    description: it.description,
    contentText: it.contentText,
    whyItMatters: it.whyItMatters,
    keyPoints: it.keyPoints,
    actionItems: it.actionItems,
    category: it.category,
    userNote: it.userNote,
    creatorUrl: it.creatorUrl,
    publishedAt: it.publishedAt?.toISOString() ?? null,
    lastViewedAt: it.lastViewedAt?.toISOString() ?? null,
    collections: cols,
    whatYouCanDo: it.whatYouCanDo,
    actionabilityReason: it.actionabilityReason,
    parentItemId: it.parentItemId,
    guides: (await db.select({ id: items.id, title: items.aiTitle, original: items.originalTitle }).from(items).where(eq(items.parentItemId, id))).map((g) => ({ id: g.id, title: g.title ?? g.original ?? "Guide" })),
  };
}

/** Returns null when the item does not exist for this user. `noteChanged` lets callers re-run analysis. */
export async function updateItem(userId: string, id: string, patch: UpdateItemRequest): Promise<{ noteChanged: boolean } | null> {
  const current = await db.query.items.findFirst({ where: and(eq(items.userId, userId), eq(items.id, id)), columns: { userNote: true, status: true } });
  if (!current) return null;
  const values: Partial<typeof items.$inferInsert> = {};
  if (patch.status) values.status = patch.status;
  if (patch.favorite !== undefined) values.favorite = patch.favorite;
  if (patch.actionable !== undefined) values.actionable = patch.actionable;
  if (patch.userNote !== undefined) values.userNote = patch.userNote?.trim() || null;
  if (patch.viewed) {
    values.lastViewedAt = new Date();
    // Opening an unread item marks it read; archived items stay archived.
    if (current.status === "unread" && !patch.status) values.status = "read";
  }
  if (Object.keys(values).length > 0) await db.update(items).set(values).where(and(eq(items.userId, userId), eq(items.id, id)));
  return { noteChanged: patch.userNote !== undefined && (values.userNote ?? null) !== (current.userNote ?? null) };
}

export async function deleteItem(userId: string, id: string, opts: { purgeHistory?: boolean } = {}): Promise<boolean> {
  if (opts.purgeHistory) {
    const { executionJobs } = await import("@/db/schema");
    await db.delete(executionJobs).where(and(eq(executionJobs.userId, userId), eq(executionJobs.itemId, id)));
  }
  const deleted = await db.delete(items).where(and(eq(items.userId, userId), eq(items.id, id))).returning({ id: items.id });
  return deleted.length > 0;
}

export interface HomeStats {
  savedToday: number;
  unread: number;
  total: number;
  processing: number;
  savedThisWeek: number;
  appliedThisWeek: number;
}

export async function homeStats(userId: string): Promise<HomeStats> {
  const [row] = await db.execute(sql`
    select
      count(*) filter (where saved_at >= date_trunc('day', now()))::int as saved_today,
      count(*) filter (where status = 'unread')::int as unread,
      count(*) filter (where status <> 'archived')::int as total,
      count(*) filter (where processing_status in ('pending', 'processing'))::int as processing,
      count(*) filter (where saved_at >= now() - interval '7 days')::int as saved_week,
      count(*) filter (where applied_at >= now() - interval '7 days')::int as applied_week
    from items where user_id = ${userId}`);
  return {
    savedToday: Number(row.saved_today),
    unread: Number(row.unread),
    total: Number(row.total),
    processing: Number(row.processing),
    savedThisWeek: Number(row.saved_week),
    appliedThisWeek: Number(row.applied_week),
  };
}
