import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { collectionItems, collections, items } from "@/db/schema";
import { slugify } from "@/lib/ai/schemas";
import { db } from "@/lib/db";

export interface CollectionNode {
  id: string;
  name: string;
  kind: "manual" | "smart" | "ai";
  count: number;
  updatedAt: string;
  children: CollectionNode[];
}

export async function collectionTree(userId: string): Promise<CollectionNode[]> {
  const rows = await db.execute(sql`
    select c.id, c.name, c.kind, c.parent_id, c.updated_at,
      (select count(*) from collection_items ci join items i on i.id = ci.item_id
       where ci.collection_id = c.id and i.status <> 'archived')::int as count
    from collections c where c.user_id = ${userId}`);
  const nodes = new Map<string, CollectionNode & { parentId: string | null }>(
    rows.map((r) => [
      r.id as string,
      {
        id: r.id as string,
        name: r.name as string,
        kind: r.kind as CollectionNode["kind"],
        count: Number(r.count),
        updatedAt: new Date(r.updated_at as string).toISOString(),
        parentId: (r.parent_id as string | null) ?? null,
        children: [],
      },
    ]),
  );
  const roots: CollectionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const byCount = (a: CollectionNode, b: CollectionNode) => b.count - a.count || a.name.localeCompare(b.name);
  for (const node of nodes.values()) node.children.sort(byCount);
  return roots.filter((r) => r.count > 0 || r.kind === "manual").sort(byCount);
}

export async function createCollection(userId: string, name: string): Promise<string> {
  const base = slugify(name) || "collection";
  const [row] = await db
    .insert(collections)
    .values({ userId, name, slug: `${base}-${Date.now().toString(36)}`, kind: "manual" })
    .returning({ id: collections.id });
  return row.id;
}

export async function setMembership(userId: string, collectionId: string, itemId: string, member: boolean): Promise<boolean> {
  const [col] = await db.select({ id: collections.id }).from(collections).where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));
  const [item] = await db.select({ id: items.id }).from(items).where(and(eq(items.id, itemId), eq(items.userId, userId)));
  if (!col || !item) return false;
  if (member) {
    await db.insert(collectionItems).values({ collectionId, itemId, addedBy: "user" }).onConflictDoUpdate({
      target: [collectionItems.collectionId, collectionItems.itemId],
      set: { addedBy: "user" },
    });
  } else {
    await db.delete(collectionItems).where(and(eq(collectionItems.collectionId, collectionId), eq(collectionItems.itemId, itemId)));
  }
  return true;
}
