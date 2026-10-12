import "server-only";
import { streamAnswer } from "@/lib/ai/services";
import type { AskContextItem } from "@/lib/ai/prompts/ask-inbox";
import { getItem } from "@/lib/items/repository";
import type { ItemSummary } from "@/lib/items/types";
import { hybridSearch } from "./hybrid";

const CONTEXT_ITEMS = 8;

export interface AskSource {
  index: number;
  item: ItemSummary;
}

/** Retrieve → pack context → stream. Sources are numbered exactly as the model sees them. */
export async function askInbox(userId: string, question: string): Promise<{ sources: AskSource[]; stream: AsyncGenerator<string> }> {
  const hits = (await hybridSearch(userId, question, CONTEXT_ITEMS)).filter((h) => h.score > 0.12);
  const details = (await Promise.all(hits.map((h) => getItem(userId, h.item.id)))).filter((d) => d !== null);
  const context: AskContextItem[] = details.map((d, i) => ({
    index: i + 1,
    title: d.title,
    source: d.domain ?? d.sourceType,
    savedAt: d.savedAt.slice(0, 10),
    summary: d.summary,
    keyPoints: d.keyPoints,
    whyItMatters: d.whyItMatters,
    userNote: d.userNote,
    tags: d.tags,
  }));
  return {
    sources: details.map((d, i) => ({ index: i + 1, item: d })),
    stream: streamAnswer(question, context, userId),
  };
}
