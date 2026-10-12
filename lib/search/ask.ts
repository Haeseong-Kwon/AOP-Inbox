import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { STATUS_LABELS } from "@aop-inbox/core";
import { executionJobs } from "@/db/schema";
import { streamAnswer } from "@/lib/ai/services";
import type { AskContextItem, AskExecutionContext } from "@/lib/ai/prompts/ask-inbox";
import { db } from "@/lib/db";
import { getItem } from "@/lib/items/repository";
import type { ItemSummary } from "@/lib/items/types";
import { hybridSearch } from "./hybrid";

const CONTEXT_ITEMS = 8;
const EXECUTION_QUESTION = /(install|set ?up|setup|appl(y|ied)|configur|mcp|run|ran|설치|적용|세팅|실행|구성)/i;

export interface AskSource {
  index: number;
  item: ItemSummary;
}

export interface AskExecutionSource {
  label: string;
  jobId: string;
  itemId: string | null;
  itemTitle: string;
  status: string;
  date: string;
}

const ACTION_LABELS: Record<string, string> = {
  action_ready: "setup ready to apply (not applied yet)",
  needs_approval: "setup waiting for approval",
  running: "setup running",
  waiting_user: "setup waiting for the owner",
  blocked: "setup blocked by safety rules",
  applied: "applied",
};

/** Retrieve → pack context (items + execution records) → stream. Numbering matches what the model sees. */
export async function askInbox(
  userId: string,
  question: string,
): Promise<{ sources: AskSource[]; executions: AskExecutionSource[]; setups: ItemSummary[]; stream: AsyncGenerator<string> }> {
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
    action: d.actionState && ACTION_LABELS[d.actionState] ? `${ACTION_LABELS[d.actionState]}${d.appliedAt ? ` on ${d.appliedAt.slice(0, 10)}` : ""}` : null,
  }));

  // Execution records: those behind the retrieved items, plus recent ones when the question is about setups.
  const itemIds = details.map((d) => d.id);
  const linked = itemIds.length
    ? await db.select().from(executionJobs).where(and(eq(executionJobs.userId, userId), inArray(executionJobs.itemId, itemIds))).orderBy(desc(executionJobs.createdAt)).limit(8)
    : [];
  const recent = EXECUTION_QUESTION.test(question)
    ? await db.select().from(executionJobs).where(eq(executionJobs.userId, userId)).orderBy(desc(executionJobs.createdAt)).limit(6)
    : [];
  const jobs = [...new Map([...linked, ...recent].map((j) => [j.id, j])).values()].slice(0, 8);
  const executions: AskExecutionSource[] = jobs.map((j, i) => ({
    label: `E${i + 1}`,
    jobId: j.id,
    itemId: j.itemId,
    itemTitle: j.itemTitle,
    status: STATUS_LABELS[j.status],
    date: (j.completedAt ?? j.createdAt).toISOString().slice(0, 10),
  }));
  const execContext: AskExecutionContext[] = jobs.map((j, i) => ({
    label: `E${i + 1}`,
    itemTitle: j.itemTitle,
    status: STATUS_LABELS[j.status],
    date: (j.completedAt ?? j.createdAt).toISOString().slice(0, 10),
    summary: j.spec.summary,
  }));

  return {
    sources: details.map((d, i) => ({ index: i + 1, item: d })),
    executions,
    // Suggested actions: link to review, never run from a chat answer.
    setups: details.filter((d) => d.actionState === "action_ready"),
    stream: streamAnswer(question, context, userId, execContext),
  };
}
