import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { items } from "@/db/schema";
import { db } from "@/lib/db";
import { commitImport, previewImport } from "@/lib/import/service";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { hybridSearch, relatedItems } from "@/lib/search/hybrid";
import { resetDatabase } from "./helpers";

let userId: string;
beforeEach(async () => {
  userId = await resetDatabase();
});

describe("hybrid search", () => {
  beforeEach(async () => {
    await captureItem(userId, { input: "Running several coding agents in parallel using git worktrees" });
    await captureItem(userId, { input: "SaaS onboarding teardown: ask one question, personalize the rest" });
    await captureItem(userId, { input: "마케팅 자동화 아이디어: 댓글 키워드로 DM 퍼널 만들기" });
    await drainQueue(20_000);
  });

  it("ranks the keyword match first and explains why", async () => {
    const hits = await hybridSearch(userId, "worktrees");
    expect(hits[0].item.title).toMatch(/worktrees/i);
    expect(hits[0].reasons.length).toBeGreaterThan(0);
  });

  it("finds Korean content", async () => {
    const hits = await hybridSearch(userId, "마케팅 자동화");
    expect(hits[0]?.item.title).toMatch(/마케팅/);
  });

  it("matches partial phrasing through the vector + trigram paths", async () => {
    const hits = await hybridSearch(userId, "parallel agents");
    expect(hits.map((h) => h.item.title).join(" ")).toMatch(/agents/i);
  });

  it("returns related items by embedding similarity", async () => {
    const [agent] = await hybridSearch(userId, "worktrees");
    const related = await relatedItems(userId, agent.item.id);
    expect(related.every((r) => r.id !== agent.item.id)).toBe(true);
  });
});

describe("Meta export import", () => {
  const links = [
    { url: "https://www.instagram.com/reel/AAA/?igsh=1", timestamp: 1_700_000_000_000 },
    { url: "https://instagram.com/reel/AAA/", timestamp: 1_690_000_000_000 }, // same reel, earlier share
    { url: "https://www.instagram.com/p/BBB/", timestamp: 1_700_000_100_000 },
    { url: "https://example.com/article?utm_source=x" },
    { url: "not a url" },
  ];

  it("previews counts without writing anything", async () => {
    const preview = await previewImport(userId, { links, includeOtherLinks: false });
    expect(preview).toMatchObject({ totalLinks: 4, instagramReels: 1, instagramPosts: 1, otherLinks: 1, duplicates: 1, newItems: 2 });
    expect(await db.$count(items)).toBe(0);
  });

  it("imports Instagram links dated by the earliest share and skips existing items", async () => {
    await captureItem(userId, { input: "https://www.instagram.com/p/BBB/" });
    const { stats } = await commitImport(userId, { links, includeOtherLinks: false });
    expect(stats.created).toBe(1);
    const reel = await db.query.items.findFirst({ where: eq(items.externalId, "AAA") });
    expect(reel?.savedAt.getTime()).toBe(1_690_000_000_000);
    expect(reel?.importId).toBe(stats && reel?.importId);
    expect(await db.$count(items)).toBe(2);
  });

  it("optionally includes other links", async () => {
    const { stats } = await commitImport(userId, { links, includeOtherLinks: true });
    expect(stats.created).toBe(3);
  });
});
