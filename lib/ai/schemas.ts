import { CONTENT_INTENTS } from "@aop-inbox/core/browser";
import { z } from "zod";

/** Top-level smart collections. The analyzer must pick one; subcategories are free-form. */
export const CATEGORIES = [
  "AI & LLM",
  "Software Engineering",
  "Product Design",
  "Marketing",
  "Startups",
  "Business",
  "Productivity",
  "Inspiration",
  "Learning",
  "Lifestyle",
] as const;
export type Category = (typeof CATEGORIES)[number];

const trimmed = (max: number) => z.string().trim().max(max);

export const itemAnalysisSchema = z.object({
  title: trimmed(90).min(1).describe("Specific, scannable title. Not clickbait. Max ~70 chars."),
  summary: trimmed(400).min(1).describe("1–2 sentences: what this content actually says or shows."),
  category: z.enum(CATEGORIES),
  subcategory: trimmed(40).describe("Narrow topic inside the category, Title Case, 1–3 words, e.g. 'Coding Agents'."),
  tags: z.array(trimmed(32).min(1)).max(6).describe("3–6 lowercase topical tags, no '#'."),
  keyPoints: z.array(trimmed(200)).max(5).describe("2–5 concrete takeaways."),
  actionItems: z.array(trimmed(160)).max(3).describe("0–3 things the reader could actually do. Empty if none."),
  whyItMatters: trimmed(300).describe("Why this is worth keeping and where it could be applied. 1–2 sentences."),
  importanceScore: z.number().min(0).max(1).describe("0.0–1.0 long-term usefulness to a builder."),
  language: trimmed(8).describe("ISO 639-1 code of the content, e.g. 'en', 'ko'."),
  contentIntent: z
    .enum(CONTENT_INTENTS)
    .describe(
      "knowledge: worth knowing · reference: look up later (tools, repos, lists) · actionable: the reader should do something by hand · executable: concrete setup a local agent could run (installs, MCP, config) · requires_user: the key step needs a person (sign-up, payment, API key, login, comment-to-get-guide).",
    ),
  actionability: z.object({
    score: z.number().min(0).max(1).describe("0 = nothing to do, 1 = concrete steps to apply now."),
    reason: trimmed(200),
  }),
  executable: z.boolean().describe("True only if the content shows concrete commands or settings."),
  setupSpecCandidate: z.boolean().describe("True if a step-by-step setup plan could be extracted."),
  whatYouCanDo: trimmed(300).describe("For actionable/executable content: what the reader can do with it, 1 sentence. Empty string otherwise."),
});
export type ItemAnalysis = z.infer<typeof itemAnalysisSchema>;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
