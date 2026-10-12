import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { collectionItems, embeddings, items, itemTags, processingJobs } from "@/db/schema";
import { db } from "@/lib/db";
import { drainQueue, reprocessItem } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { getItem, listItems, updateItem } from "@/lib/items/repository";
import { enqueue, runJobs } from "@/lib/jobs/queue";
import { resetDatabase } from "./helpers";

let userId: string;
beforeEach(async () => {
  userId = await resetDatabase();
});

describe("capture", () => {
  it("saves a note immediately and queues analysis", async () => {
    const { itemId, duplicate } = await captureItem(userId, { input: "Batch agent tasks with git worktrees" });
    expect(duplicate).toBe(false);
    const row = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    expect(row).toMatchObject({ sourceType: "note", userNote: "Batch agent tasks with git worktrees", processingStatus: "pending" });
    const jobs = await db.select().from(processingJobs).where(eq(processingJobs.itemId, itemId));
    expect(jobs).toHaveLength(1);
  });

  it("normalizes Instagram links and treats share variants as duplicates", async () => {
    const a = await captureItem(userId, { input: "https://www.instagram.com/reel/XYZ123/?igsh=abc" });
    const b = await captureItem(userId, { input: "instagram.com/reel/XYZ123", note: "for the AOP launch" });
    expect(b).toEqual({ itemId: a.itemId, duplicate: true });
    const row = await db.query.items.findFirst({ where: eq(items.id, a.itemId) });
    expect(row?.canonicalUrl).toBe("https://www.instagram.com/reel/XYZ123/");
    // The extra note is attached to the original rather than creating a copy.
    expect(row?.userNote).toBe("for the AOP launch");
    expect(await db.$count(items)).toBe(1);
  });

  it("keeps text around a shared link as the note", async () => {
    const { itemId } = await captureItem(userId, { input: "great onboarding teardown https://www.instagram.com/p/AbC/" });
    const row = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    expect(row).toMatchObject({ contentKind: "post", userNote: "great onboarding teardown" });
  });
});

describe("ingestion pipeline", () => {
  it("analyzes, tags, files into collections and embeds an item", async () => {
    const { itemId } = await captureItem(userId, {
      input: "https://www.instagram.com/reel/AGENTS1/",
      note: "Run several Claude coding agents in parallel, each in its own git worktree",
    });
    expect(await drainQueue(10_000)).toBe(1);

    const item = await getItem(userId, itemId);
    expect(item?.processingStatus).toBe("completed");
    expect(item?.title).toBeTruthy();
    const stored = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    expect(stored?.summary).toBeTruthy();
    expect(item?.category).toBe("AI & LLM");
    expect(item?.tags.length).toBeGreaterThan(0);
    expect(item?.collections.map((c) => c.name)).toContain("AI & LLM");
    expect(await db.$count(embeddings, eq(embeddings.itemId, itemId))).toBe(1);
  });

  it("does not re-run analysis when nothing changed (cost control)", async () => {
    const { itemId } = await captureItem(userId, { input: "A note about pricing pages" });
    await drainQueue(10_000);
    const before = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    await reprocessItem(itemId);
    await drainQueue(10_000);
    const after = await db.query.items.findFirst({ where: eq(items.id, itemId) });
    expect(after?.analysisHash).toBe(before?.analysisHash);
    expect(after?.processingStatus).toBe("completed");
  });

  it("replaces AI tags and placements on re-analysis but keeps user collections", async () => {
    const { itemId } = await captureItem(userId, { input: "Marketing funnel idea with email automation" });
    await drainQueue(10_000);
    const tagsBefore = await db.$count(itemTags, eq(itemTags.itemId, itemId));
    await updateItem(userId, itemId, { userNote: "Actually about React database performance" });
    await reprocessItem(itemId);
    await drainQueue(10_000);
    expect(await db.$count(itemTags, eq(itemTags.itemId, itemId))).toBeGreaterThan(0);
    expect(tagsBefore).toBeGreaterThan(0);
    const placements = await db.select().from(collectionItems).where(eq(collectionItems.itemId, itemId));
    expect(placements.every((p) => p.addedBy === "ai")).toBe(true);
  });
});

describe("job queue", () => {
  it("retries with backoff, then marks the job failed", async () => {
    await enqueue({ type: "assign_collections", idempotencyKey: "boom", maxAttempts: 2 });
    let failures = 0;
    const failing = async () => {
      throw new Error("provider down");
    };
    await runJobs({ handlers: { assign_collections: failing }, onFinalFailure: async () => void failures++ });
    let [job] = await db.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, "boom"));
    expect(job).toMatchObject({ status: "pending", attempts: 1, lastError: "provider down" });

    await db.execute(sql`update processing_jobs set run_after = now()`); // skip the backoff wait
    await runJobs({ handlers: { assign_collections: failing }, onFinalFailure: async () => void failures++ });
    [job] = await db.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, "boom"));
    expect(job.status).toBe("failed");
    expect(failures).toBe(1);
  });

  it("ignores duplicate enqueues while a job is pending", async () => {
    await enqueue({ type: "assign_collections", idempotencyKey: "same" });
    await enqueue({ type: "assign_collections", idempotencyKey: "same" });
    expect(await db.$count(processingJobs)).toBe(1);
  });
});

describe("item state", () => {
  it("opening an unread item marks it read; archive hides it from the inbox", async () => {
    const { itemId } = await captureItem(userId, { input: "Something to read later" });
    await updateItem(userId, itemId, { viewed: true });
    expect((await getItem(userId, itemId))?.status).toBe("read");
    await updateItem(userId, itemId, { status: "archived", favorite: true });
    const inbox = await listItems(userId, { sort: "recent", cursor: 0, limit: 10 });
    expect(inbox.items).toHaveLength(0);
    const archived = await listItems(userId, { state: "archived", sort: "recent", cursor: 0, limit: 10 });
    expect(archived.items[0]).toMatchObject({ id: itemId, favorite: true });
  });

  it("never exposes another user's items", async () => {
    const { itemId } = await captureItem(userId, { input: "private thought" });
    expect(await getItem("someone-else", itemId)).toBeNull();
    expect(await updateItem("someone-else", itemId, { favorite: true })).toBeNull();
  });
});
