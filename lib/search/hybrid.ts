import "server-only";
import { sql } from "drizzle-orm";
import { embedTexts, embeddingModelId } from "@/lib/ai/services";
import { db } from "@/lib/db";
import { getSummaries } from "@/lib/items/repository";
import type { ItemSummary } from "@/lib/items/types";
import { errorMessage, log } from "@/lib/log";

/**
 * query → keyword candidates (tsvector + trigram + tags + note)
 *       + vector candidates (pgvector cosine)
 *       → weighted fusion with recency + importance → ranked, explained results.
 */

export type MatchReason = "title" | "note" | "tag" | "content" | "meaning" | "setup";

export interface SearchHit {
  item: ItemSummary;
  score: number;
  reasons: MatchReason[];
}

const WEIGHTS = { semantic: 0.5, keyword: 0.35, importance: 0.1, recency: 0.05 };
const CANDIDATES = 60;
// Below this cosine similarity a vector hit is noise, not "similar meaning".
const MIN_SIMILARITY = 0.25;
const RECENCY_HALF_LIFE_DAYS = 45;

interface KeywordRow {
  id: string;
  rank: number;
  title_hit: boolean;
  note_hit: boolean;
  tag_hit: boolean;
  setup_hit: boolean;
}

async function keywordCandidates(userId: string, query: string): Promise<KeywordRow[]> {
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.execute(sql`
    with q as (select websearch_to_tsquery('simple', ${query}) as tsq)
    select i.id,
      ts_rank(i.search_vector, q.tsq) + similarity(i.search_text, ${query}) * 0.5
        + ts_rank(to_tsvector('simple', coalesce(i.action_text, '')), q.tsq) * 0.8 as rank,
      (coalesce(i.action_text, '') ilike ${like} or to_tsvector('simple', coalesce(i.action_text, '')) @@ q.tsq) as setup_hit,
      (coalesce(i.ai_title, i.original_title, '') ilike ${like}) as title_hit,
      (coalesce(i.user_note, '') ilike ${like}) as note_hit,
      exists (select 1 from item_tags it join tags t on t.id = it.tag_id
              where it.item_id = i.id and (t.name ilike ${like} or ${query} ilike '%' || t.name || '%')) as tag_hit
    from items i, q
    where i.user_id = ${userId}
      and (i.search_vector @@ q.tsq
           or i.search_text ilike ${like}
           or coalesce(i.action_text, '') ilike ${like}
           or to_tsvector('simple', coalesce(i.action_text, '')) @@ q.tsq
           or i.search_text % ${query}
           or exists (select 1 from item_tags it join tags t on t.id = it.tag_id where it.item_id = i.id and t.name ilike ${like}))
    order by rank desc
    limit ${CANDIDATES}`);
  return rows as unknown as KeywordRow[];
}

async function vectorCandidates(userId: string, query: string): Promise<Map<string, number>> {
  try {
    const [vector] = await embedTexts([query], "embed_query", userId);
    return similarTo(userId, vector, CANDIDATES);
  } catch (error) {
    // Semantic search is an enhancement — keyword results still work without it.
    log.warn("search.vector_failed", { error: errorMessage(error) });
    return new Map();
  }
}

export async function similarTo(userId: string, vector: number[], limit: number, excludeId?: string): Promise<Map<string, number>> {
  const literal = `[${vector.join(",")}]`;
  const rows = await db.execute(sql`
    select e.item_id as id, 1 - (e.embedding <=> ${literal}::vector) as similarity
    from embeddings e join items i on i.id = e.item_id
    where i.user_id = ${userId} and e.model = ${embeddingModelId()}
      ${excludeId ? sql`and e.item_id <> ${excludeId}` : sql``}
    order by e.embedding <=> ${literal}::vector
    limit ${limit}`);
  return new Map(rows.map((r) => [r.id as string, Number(r.similarity)]));
}

function recencyScore(savedAt: string): number {
  const days = (Date.now() - new Date(savedAt).getTime()) / 86_400_000;
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

export async function hybridSearch(userId: string, query: string, limit = 30): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const [keyword, vector] = await Promise.all([keywordCandidates(userId, q), vectorCandidates(userId, q)]);

  const maxRank = Math.max(...keyword.map((k) => Number(k.rank)), 1e-6);
  const kwById = new Map(keyword.map((k) => [k.id, k]));
  const ids = [...new Set([...kwById.keys(), ...[...vector.entries()].filter(([, s]) => s >= MIN_SIMILARITY).map(([id]) => id)])];
  const summaries = await getSummaries(userId, ids);

  const hits = summaries.map((item): SearchHit => {
    const kw = kwById.get(item.id);
    const sim = vector.get(item.id) ?? 0;
    const keywordScore = kw ? Math.min(1, Number(kw.rank) / maxRank + (kw.title_hit ? 0.3 : 0) + (kw.tag_hit ? 0.2 : 0)) : 0;
    const semanticScore = sim >= MIN_SIMILARITY ? sim : 0;
    const reasons: MatchReason[] = [];
    if (kw?.title_hit) reasons.push("title");
    if (kw?.note_hit) reasons.push("note");
    if (kw?.tag_hit) reasons.push("tag");
    if (kw?.setup_hit) reasons.push("setup");
    if (kw && reasons.length === 0) reasons.push("content");
    if (semanticScore > 0 && (!kw || semanticScore > 0.45)) reasons.push("meaning");
    const archivedPenalty = item.status === "archived" ? 0.85 : 1;
    const score =
      archivedPenalty *
      (WEIGHTS.semantic * semanticScore +
        WEIGHTS.keyword * keywordScore +
        WEIGHTS.importance * (item.importanceScore ?? 0.3) +
        WEIGHTS.recency * recencyScore(item.savedAt));
    return { item, score, reasons };
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function relatedItems(userId: string, itemId: string, limit = 5): Promise<ItemSummary[]> {
  const rows = await db.execute(sql`
    select embedding::text as v from embeddings where item_id = ${itemId} and model = ${embeddingModelId()} limit 1`);
  if (rows.length === 0) return [];
  const vector = JSON.parse(rows[0].v as string) as number[];
  const similar = await similarTo(userId, vector, limit * 2, itemId);
  const ids = [...similar.entries()].filter(([, s]) => s >= MIN_SIMILARITY).map(([id]) => id).slice(0, limit);
  return getSummaries(userId, ids);
}
