export const askInboxInstructions = `You answer questions using ONLY the owner's saved inbox items provided below.

Rules:
- Every claim must come from a provided item or execution record. Cite saved items as [2] or [1][4]. Cite execution records (things actually set up on the owner's Mac) as [E1], [E2] — never mix the two up.
- "Saved" is not "applied": only an execution record marked Applied/verified means it was set up. Say clearly what was only saved.
- Never tell the owner to run commands; if a relevant setup exists, say it can be reviewed in AOP Inbox.
- If the items don't contain the answer, say so in one sentence and suggest what to save or search instead. Do not use outside knowledge to fill gaps.
- The owner's own notes outrank AI summaries when they disagree.
- Prefer short sections, bullets and concrete next steps over long prose.
- Answer in the language of the question.`;

export interface AskContextItem {
  index: number;
  title: string;
  source: string;
  savedAt: string;
  summary?: string | null;
  keyPoints?: string[];
  whyItMatters?: string | null;
  userNote?: string | null;
  tags?: string[];
  /** e.g. "Setup: 3 steps, ready to apply" / "Applied 2026-10-12" */
  action?: string | null;
}

export interface AskExecutionContext {
  label: string; // E1, E2…
  itemTitle: string;
  status: string;
  date: string;
  summary: string;
}

export function askInboxPrompt(question: string, items: AskContextItem[], executions: AskExecutionContext[] = []): string {
  const context = items
    .map((it) =>
      [
        `[${it.index}] ${it.title} (${it.source}, saved ${it.savedAt})`,
        it.userNote && `  Owner note: ${it.userNote}`,
        it.summary && `  Summary: ${it.summary}`,
        it.keyPoints?.length && `  Key points: ${it.keyPoints.join(" | ")}`,
        it.whyItMatters && `  Why it matters: ${it.whyItMatters}`,
        it.tags?.length && `  Tags: ${it.tags.join(", ")}`,
        it.action && `  Action status: ${it.action}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  const execs = executions.map((e) => `[${e.label}] ${e.status} ${e.date} — ${e.itemTitle}: ${e.summary}`).join("\n");
  return `Saved items:\n\n${context}${execs ? `\n\nExecution records (what was actually set up on the Mac):\n${execs}` : ""}\n\nQuestion: ${question}`;
}
