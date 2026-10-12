export const askInboxInstructions = `You answer questions using ONLY the owner's saved inbox items provided below.

Rules:
- Every claim must come from a provided item. Cite items inline with their number in square brackets, e.g. [2] or [1][4].
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
}

export function askInboxPrompt(question: string, items: AskContextItem[]): string {
  const context = items
    .map((it) =>
      [
        `[${it.index}] ${it.title} (${it.source}, saved ${it.savedAt})`,
        it.userNote && `  Owner note: ${it.userNote}`,
        it.summary && `  Summary: ${it.summary}`,
        it.keyPoints?.length && `  Key points: ${it.keyPoints.join(" | ")}`,
        it.whyItMatters && `  Why it matters: ${it.whyItMatters}`,
        it.tags?.length && `  Tags: ${it.tags.join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `Saved items:\n\n${context}\n\nQuestion: ${question}`;
}
