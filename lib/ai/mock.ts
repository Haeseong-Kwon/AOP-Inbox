import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import type { AnalyzeItemInput } from "./prompts/analyze-item";
import { CATEGORIES, type Category, type ItemAnalysis } from "./schemas";

/**
 * Deterministic offline stand-in for the LLM, used when no AI key is set and in
 * tests. Heuristic summaries + feature-hashed embeddings: lexical, not semantic,
 * but enough for related items and keyword-ish semantic search to work.
 */

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have how i in is it its of on or that the this to was what when with you your we our can will just into than then them they there these those about more most very via over also not do does did using use used www com https http html".split(" "),
);

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  "AI & LLM": ["ai", "llm", "gpt", "claude", "agent", "agents", "model", "prompt", "rag", "embedding", "openai", "에이전트", "인공지능"],
  "Software Engineering": ["code", "coding", "typescript", "react", "api", "database", "postgres", "git", "github", "deploy", "engineering", "개발"],
  "Product Design": ["design", "ux", "ui", "onboarding", "figma", "interface", "typography", "디자인"],
  Marketing: ["marketing", "growth", "seo", "ads", "campaign", "email", "funnel", "content", "brand", "마케팅"],
  Startups: ["startup", "founder", "yc", "fundraising", "mvp", "launch", "pmf", "창업"],
  Business: ["business", "revenue", "pricing", "saas", "sales", "strategy", "market"],
  Productivity: ["productivity", "workflow", "habit", "focus", "notion", "automation", "생산성"],
  Inspiration: ["inspiration", "art", "creative", "story", "motivation"],
  Learning: ["learn", "course", "tutorial", "paper", "research", "study", "book"],
  Lifestyle: ["food", "travel", "fitness", "health", "recipe"],
};

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function topKeywords(text: string, n: number): string[] {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) if (t.length > 2 && !/^\d+$/.test(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

function firstSentences(text: string, maxChars: number): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?。])\s+/);
  let out = "";
  for (const s of sentences) {
    if ((out + " " + s).trim().length > maxChars) break;
    out = (out + " " + s).trim();
  }
  return out || clip(text.replace(/\s+/g, " ").trim(), maxChars);
}

const COMMAND_LINE = /(^|\n)\s*(?:\$\s*)?(npm|npx|pnpm|yarn|bun|brew|pip3?|pipx|uvx?|claude|git|curl|wget|node|python3?|mkdir|docker|cargo|go)\s+\S+/i;
const NEEDS_PERSON = /(api[ _-]?key|sign[ -]?up|회원가입|결제|subscribe|log ?in|로그인|oauth|발급|create an account|billing)/i;
const GUIDE_GATE = /(comment|댓글).{0,40}(guide|가이드|dm|디엠|보내)/i;
const DO_VERBS = /\b(try|set up|setup|configure|install|build|create|add|enable|follow these|step \d)\b|해보세요|설정|만들어|설치|따라/i;
const REFERENCE = /(awesome|list of|alternatives|comparison|vs\.?|repo|library|libraries|도구 모음|레퍼런스)/i;

/** Heuristic intent for offline mode; the real classifier is the LLM. */
export function mockIntent(text: string): Pick<ItemAnalysis, "contentIntent" | "actionability" | "executable" | "setupSpecCandidate"> {
  if (GUIDE_GATE.test(text)) {
    return { contentIntent: "requires_user", actionability: { score: 0.6, reason: "The creator shares the guide only after a comment." }, executable: false, setupSpecCandidate: true };
  }
  if (COMMAND_LINE.test(text)) {
    const person = NEEDS_PERSON.test(text);
    return {
      contentIntent: "executable",
      actionability: { score: 0.85, reason: person ? "Shows setup commands, plus a step only you can do." : "Shows concrete setup commands." },
      executable: true,
      setupSpecCandidate: true,
    };
  }
  if (NEEDS_PERSON.test(text) && DO_VERBS.test(text)) {
    return { contentIntent: "requires_user", actionability: { score: 0.55, reason: "Needs an account, key or payment from you." }, executable: false, setupSpecCandidate: true };
  }
  if (DO_VERBS.test(text)) return { contentIntent: "actionable", actionability: { score: 0.5, reason: "Describes something to try by hand." }, executable: false, setupSpecCandidate: false };
  if (REFERENCE.test(text)) return { contentIntent: "reference", actionability: { score: 0.15, reason: "Material to look up later." }, executable: false, setupSpecCandidate: false };
  return { contentIntent: "knowledge", actionability: { score: 0.1, reason: "Information to keep." }, executable: false, setupSpecCandidate: false };
}

export function mockAnalyze(input: AnalyzeItemInput): ItemAnalysis {
  const body = [input.userNote, input.title, input.description, input.content].filter(Boolean).join(". ");
  const tokens = new Set(tokenize(body));
  const scored = CATEGORIES.map((c) => ({ c, score: CATEGORY_KEYWORDS[c].filter((k) => tokens.has(k)).length }));
  const best = scored.sort((a, b) => b.score - a.score)[0];
  const category: Category = best.score > 0 ? best.c : input.sourceType === "note" ? "Productivity" : "Inspiration";
  const keywords = topKeywords(body, 6);
  const fallbackTitle = input.url ? `${input.sourceType === "instagram" ? "Instagram " : ""}${new URL(input.url).pathname.split("/").filter(Boolean)[0] ?? "link"} from ${new URL(input.url).hostname.replace(/^www\./, "")}` : "Untitled note";
  const title = (input.title || firstSentences(input.userNote || input.content || "", 70) || fallbackTitle).slice(0, 90);
  const summary = body ? firstSentences(input.description || input.content || input.userNote || body, 220) : "Saved link — no readable content was available, so this card is based on the URL only.";
  return {
    title,
    summary,
    category,
    subcategory: keywords[0] ? keywords[0][0].toUpperCase() + keywords[0].slice(1) : "General",
    tags: keywords.slice(0, 4),
    keyPoints: (input.content || input.description || "")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 30)
      .slice(0, 3)
      .map((s) => s.slice(0, 200)),
    actionItems: [],
    whyItMatters: `Filed under ${category}${keywords[0] ? `, around ${keywords.slice(0, 2).join(" and ")}` : ""}. Add an AI key for a real explanation of why it matters.`,
    importanceScore: Math.min(0.85, 0.25 + Math.min(tokens.size, 120) / 240 + (input.userNote ? 0.15 : 0)),
    language: /[가-힣]/.test(body) ? "ko" : "en",
    ...mockIntent([input.userNote, input.description, input.content].filter(Boolean).join("\n")),
    whatYouCanDo: "",
  };
}

function hash(token: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mockEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  // Unigrams + character trigrams so Korean/compound words partially match.
  const features = tokens.flatMap((t) => [t, ...(t.length > 3 ? Array.from({ length: t.length - 2 }, (_, i) => `#${t.slice(i, i + 3)}`) : [])]);
  for (const f of features) {
    const h = hash(f, 0);
    vec[h % EMBEDDING_DIMENSIONS] += hash(f, 1) & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}
