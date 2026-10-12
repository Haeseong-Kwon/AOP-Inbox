import { CATEGORIES } from "../schemas";

export const ANALYZE_ITEM_VERSION = 1;

export const analyzeItemInstructions = `You are the librarian of a personal knowledge inbox.
The owner saves Instagram Reels, articles, videos, repos and quick notes, then searches them weeks later.
Your job: turn one saved item into a compact, accurate index card.

Rules:
- Use only the information given. If the content is thin (e.g. only a URL), say so plainly and keep the card short — never invent what a video "shows".
- Be concise. The UI shows these fields in small spaces.
- Write the card in the same language as the user's note if present, otherwise the content's language.
- "category" must be one of: ${CATEGORIES.join(", ")}.
- "whyItMatters" explains usefulness for someone building products, not a restatement of the summary.
- importanceScore: 0.8+ only for rare, high-leverage material; thin or generic items stay below 0.4.`;

export interface AnalyzeItemInput {
  sourceType: string;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  creator?: string | null;
  content?: string | null;
  userNote?: string | null;
  existingSubcategories?: string[];
}

export function analyzeItemPrompt(input: AnalyzeItemInput): string {
  const lines = [
    `Source: ${input.sourceType}`,
    input.url && `URL: ${input.url}`,
    input.creator && `Creator: ${input.creator}`,
    input.title && `Original title: ${input.title}`,
    input.description && `Description: ${input.description}`,
    input.userNote && `Owner's note (most important signal): ${input.userNote}`,
    input.content && `Content:\n${input.content.slice(0, 6000)}`,
    input.existingSubcategories?.length &&
      `Existing subcategories (reuse one if it fits): ${input.existingSubcategories.join(", ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}
