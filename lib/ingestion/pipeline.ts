import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { collectionItems, collections, embeddings, items, itemTags, tags, type Item } from "@/db/schema";
import { analyzeItem, embedTexts, embeddingModelId } from "@/lib/ai/services";
import { ANALYZE_ITEM_VERSION } from "@/lib/ai/prompts/analyze-item";
import { slugify, type ItemAnalysis } from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { enqueue, runJobs, type Job } from "@/lib/jobs/queue";
import { ACTION_INTENTS, enqueueActionExtraction, extractActionsForItem } from "@/lib/actions/pipeline";
import { syncItemActionState } from "@/lib/actions/state";
import { errorMessage, log } from "@/lib/log";
import { enrichSource } from "@/lib/sources/enrich";
import type { NormalizedSource } from "@/lib/sources/normalize";

/**
 * CAPTURE → (normalize, dedupe: lib/items/capture) → ENRICH → ANALYZE → EMBED → COLLECTIONS
 * Each stage persists its result and advances items.processing_stage, so a retry
 * resumes where it stopped and nothing already paid for is recomputed.
 */

export const KNOWLEDGE_DOC_VERSION = 1;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function enqueueProcessing(itemId: string, executor?: Parameters<typeof enqueue>[1]) {
  return enqueue({ type: "process_item", itemId, idempotencyKey: `process_item:${itemId}` }, executor);
}

async function loadItem(itemId: string): Promise<Item | undefined> {
  return db.query.items.findFirst({ where: eq(items.id, itemId) });
}

/* ─── Stage 1: enrich ──────────────────────────────────────────────────── */

async function enrich(item: Item): Promise<Item> {
  if (!item.canonicalUrl || !item.sourceUrl) return item;
  const source: NormalizedSource = {
    sourceType: item.sourceType,
    sourceUrl: item.sourceUrl,
    canonicalUrl: item.canonicalUrl,
    externalId: item.externalId ?? undefined,
    contentKind: item.contentKind ?? undefined,
  };
  try {
    const meta = await enrichSource(source);
    // Never overwrite something the user (or an earlier run) already provided.
    const [updated] = await db
      .update(items)
      .set({
        originalTitle: item.originalTitle ?? meta.title,
        description: item.description ?? meta.description,
        thumbnailUrl: item.thumbnailUrl ?? meta.thumbnailUrl,
        creatorName: item.creatorName ?? meta.creatorName,
        creatorUrl: item.creatorUrl ?? meta.creatorUrl,
        siteName: item.siteName ?? meta.siteName,
        publishedAt: item.publishedAt ?? meta.publishedAt,
        contentText: item.contentText ?? meta.contentText,
        processingStage: "analyze",
      })
      .where(eq(items.id, item.id))
      .returning();
    return updated;
  } catch (error) {
    // Metadata is optional — degrade to URL-only and keep going.
    log.warn("ingest.enrich_failed", { itemId: item.id, sourceType: item.sourceType, error: errorMessage(error) });
    const [updated] = await db.update(items).set({ processingStage: "analyze" }).where(eq(items.id, item.id)).returning();
    return updated;
  }
}

/* ─── Stage 2: analyze ─────────────────────────────────────────────────── */

/** Fed back to the analyzer so subcategories converge instead of fragmenting. */
async function existingSubcategories(userId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select c.name from collections c
    where c.user_id = ${userId} and c.kind = 'ai' and c.parent_id is not null
    order by c.created_at limit 40`);
  return rows.map((r) => r.name as string);
}

async function upsertCollection(userId: string, name: string, parentId: string | null): Promise<string> {
  const slug = parentId ? `${slugify(name)}--${parentId.slice(0, 8)}` : slugify(name);
  const [row] = await db
    .insert(collections)
    .values({ userId, name, slug, parentId, kind: "ai" })
    .onConflictDoUpdate({ target: [collections.userId, collections.slug], set: { updatedAt: new Date() } })
    .returning({ id: collections.id });
  return row.id;
}

async function applyTagsAndCollections(item: Item, analysis: ItemAnalysis) {
  const tagNames = [...new Set(analysis.tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()).filter(Boolean))];
  await db.delete(itemTags).where(eq(itemTags.itemId, item.id));
  if (tagNames.length) {
    const tagRows = await db
      .insert(tags)
      .values(tagNames.map((name) => ({ userId: item.userId, name, slug: slugify(name) || name })))
      .onConflictDoUpdate({ target: [tags.userId, tags.slug], set: { name: sql`excluded.name` } })
      .returning({ id: tags.id });
    await db.insert(itemTags).values(tagRows.map((t) => ({ itemId: item.id, tagId: t.id }))).onConflictDoNothing();
  }

  // Re-analysis replaces AI placements; collections the user chose stay put.
  await db.delete(collectionItems).where(and(eq(collectionItems.itemId, item.id), eq(collectionItems.addedBy, "ai")));
  const parentId = await upsertCollection(item.userId, analysis.category, null);
  const childIds = analysis.subcategory && analysis.subcategory.toLowerCase() !== "general"
    ? [await upsertCollection(item.userId, analysis.subcategory, parentId)]
    : [];
  await db
    .insert(collectionItems)
    .values([parentId, ...childIds].map((collectionId) => ({ collectionId, itemId: item.id, addedBy: "ai" as const })))
    .onConflictDoNothing();
}

async function analyze(item: Item): Promise<Item> {
  const input = {
    sourceType: item.sourceType,
    url: item.canonicalUrl,
    title: item.originalTitle,
    description: item.description,
    creator: item.creatorName,
    content: item.contentText,
    userNote: item.userNote,
  };
  const inputHash = sha(JSON.stringify({ v: ANALYZE_ITEM_VERSION, ...input }));
  if (item.analysisHash === inputHash && item.aiTitle) {
    const [updated] = await db.update(items).set({ processingStage: "embed" }).where(eq(items.id, item.id)).returning();
    return updated;
  }

  const subcategories = await existingSubcategories(item.userId);
  const { analysis, model } = await analyzeItem({ ...input, existingSubcategories: subcategories }, item.userId);
  return applyAnalysis(item, analysis, model, inputHash);
}

/** Persist an analysis (fields, tags, AI collections) and advance to the embed stage. */
export async function applyAnalysis(item: Item, analysis: ItemAnalysis, model: string, inputHash: string | null = null): Promise<Item> {
  await applyTagsAndCollections(item, analysis);
  const [updated] = await db
    .update(items)
    .set({
      aiTitle: analysis.title,
      summary: analysis.summary,
      category: analysis.category,
      keyPoints: analysis.keyPoints,
      actionItems: analysis.actionItems,
      actionable: analysis.actionItems.length > 0,
      whyItMatters: analysis.whyItMatters,
      importanceScore: analysis.importanceScore,
      language: analysis.language,
      contentIntent: analysis.contentIntent,
      actionabilityScore: analysis.actionability.score,
      actionabilityReason: analysis.actionability.reason || null,
      whatYouCanDo: analysis.whatYouCanDo || null,
      analysisHash: inputHash,
      analysisModel: model,
      processingStage: "embed",
    })
    .where(eq(items.id, item.id))
    .returning();
  return updated;
}

/* ─── Stage 3: embed ───────────────────────────────────────────────────── */

export async function knowledgeDocument(item: Item): Promise<string> {
  const tagRows = await db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, item.id));
  return [
    item.aiTitle ?? item.originalTitle,
    item.userNote && `Note: ${item.userNote}`,
    item.summary,
    item.keyPoints.length > 0 && item.keyPoints.join(". "),
    item.whyItMatters,
    item.category,
    tagRows.length > 0 && `Tags: ${tagRows.map((t) => t.name).join(", ")}`,
    item.creatorName,
    item.description?.slice(0, 500),
    item.actionText && `Actions: ${item.actionText.slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function embed(item: Item): Promise<void> {
  const doc = await knowledgeDocument(item);
  const model = embeddingModelId();
  const contentHash = sha(`${KNOWLEDGE_DOC_VERSION}:${doc}`);
  const existing = await db.query.embeddings.findFirst({
    where: and(eq(embeddings.itemId, item.id), eq(embeddings.model, model)),
    columns: { contentHash: true },
  });
  if (existing?.contentHash !== contentHash) {
    const [vector] = await embedTexts([doc], "embed_item", item.userId);
    await db
      .insert(embeddings)
      .values({ itemId: item.id, model, version: KNOWLEDGE_DOC_VERSION, contentHash, embedding: vector })
      .onConflictDoUpdate({
        target: [embeddings.itemId, embeddings.model],
        set: { embedding: vector, contentHash, version: KNOWLEDGE_DOC_VERSION, createdAt: new Date() },
      });
  }
  await db
    .update(items)
    .set({ processingStage: "done", processingStatus: "completed", processingError: null })
    .where(eq(items.id, item.id));
}

/* ─── Orchestration ────────────────────────────────────────────────────── */

export async function processItem(job: Job): Promise<void> {
  if (!job.itemId) return;
  let item = await loadItem(job.itemId);
  if (!item) return; // deleted meanwhile
  [item] = await db.update(items).set({ processingStatus: "processing" }).where(eq(items.id, item.id)).returning();
  if (item.processingStage === "enrich") item = await enrich(item);
  if (item.processingStage === "analyze") item = await analyze(item);
  if (item.processingStage === "embed") await embed(item);
  // Action layer: only content the analyzer judged actionable gets the (more expensive) extraction.
  if (item.contentIntent && ACTION_INTENTS.has(item.contentIntent)) {
    await db.update(items).set({ actionState: "analyzing" }).where(and(eq(items.id, item.id), isNull(items.actionState)));
    await enqueueActionExtraction(item.id);
  } else {
    await syncItemActionState(item.id);
  }
}

/** Re-embed after the action digest changed, without touching processing status. */
export async function reembedItem(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  if (item && item.processingStatus === "completed") await embed(item);
}

async function extractActions(job: Job): Promise<void> {
  if (job.itemId) await extractActionsForItem(job.itemId);
}

async function markFailed(job: Job, error: unknown) {
  if (!job.itemId) return;
  log.error("ingest.item_failed", { itemId: job.itemId, error: errorMessage(error) });
  await db
    .update(items)
    .set({ processingStatus: "failed", processingError: "We saved the link, but couldn't analyze it yet." })
    .where(eq(items.id, job.itemId));
}

/** Handlers registered by other modules (follow-ups, maintenance) without import cycles. */
const extraHandlers: Partial<Record<Job["type"], (job: Job) => Promise<void>>> = {};
export function registerJobHandler(type: Job["type"], handler: (job: Job) => Promise<void>): void {
  extraHandlers[type] = handler;
}

export function drainQueue(budgetMs?: number): Promise<number> {
  return runJobs({
    handlers: { process_item: processItem, extract_actions: extractActions, ...extraHandlers },
    onFinalFailure: async (job, error) => {
      if (job.type === "process_item") await markFailed(job, error);
      if (job.type === "extract_actions" && job.itemId) {
        log.error("actions.extraction_failed", { itemId: job.itemId, error: errorMessage(error) });
        await db.update(items).set({ actionState: null }).where(eq(items.id, job.itemId));
      }
    },
    budgetMs,
  });
}

/** Re-run analysis for an item (user hit "Retry analysis" or edited their note). */
export async function reprocessItem(itemId: string, fromStage: "enrich" | "analyze" = "analyze") {
  await db
    .update(items)
    .set({ processingStatus: "pending", processingStage: fromStage, processingError: null })
    .where(eq(items.id, itemId));
  await enqueueProcessing(itemId);
}

/** Embeddings created by a different model or doc version need re-indexing. */
export async function enqueueStaleEmbeddings(userId: string): Promise<number> {
  const model = embeddingModelId();
  const stale = await db
    .select({ id: items.id })
    .from(items)
    .leftJoin(embeddings, and(eq(embeddings.itemId, items.id), eq(embeddings.model, model)))
    .where(and(eq(items.userId, userId), eq(items.processingStatus, "completed"), isNull(embeddings.id)));
  if (stale.length === 0) return 0;
  await db.update(items).set({ processingStage: "embed", processingStatus: "pending" }).where(inArray(items.id, stale.map((s) => s.id)));
  for (const { id } of stale) await enqueueProcessing(id);
  return stale.length;
}
