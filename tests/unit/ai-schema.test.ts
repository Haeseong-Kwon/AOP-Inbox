import { describe, expect, it } from "vitest";
import { getAIConfig } from "@/lib/ai/config";
import { mockAnalyze, mockEmbed } from "@/lib/ai/mock";
import { itemAnalysisSchema, slugify } from "@/lib/ai/schemas";

const valid = {
  title: "Parallel agents",
  summary: "Run agents side by side.",
  category: "AI & LLM",
  subcategory: "Coding Agents",
  tags: ["agents"],
  keyPoints: [],
  actionItems: [],
  whyItMatters: "Throughput.",
  importanceScore: 0.8,
  language: "en",
  contentIntent: "knowledge",
  actionability: { score: 0.1, reason: "Info" },
  executable: false,
  setupSpecCandidate: false,
  whatYouCanDo: "",
};

describe("itemAnalysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(itemAnalysisSchema.parse(valid)).toMatchObject({ category: "AI & LLM" });
  });
  it("rejects out-of-range importance, unknown categories and runaway output", () => {
    expect(itemAnalysisSchema.safeParse({ ...valid, importanceScore: 1.4 }).success).toBe(false);
    expect(itemAnalysisSchema.safeParse({ ...valid, category: "Cooking" }).success).toBe(false);
    expect(itemAnalysisSchema.safeParse({ ...valid, tags: Array(7).fill("x") }).success).toBe(false);
    expect(itemAnalysisSchema.safeParse({ ...valid, summary: "x".repeat(401) }).success).toBe(false);
  });
  it("mock analyzer output always satisfies the schema", () => {
    for (const input of [
      { sourceType: "note", userNote: "마케팅 자동화 아이디어" },
      { sourceType: "instagram", url: "https://www.instagram.com/reel/A/" },
      { sourceType: "web", url: "https://example.com", title: "T", content: "Long content about React performance. ".repeat(40) },
    ]) {
      expect(itemAnalysisSchema.safeParse(mockAnalyze(input)).success).toBe(true);
    }
  });
});

describe("AI config", () => {
  it("falls back to offline mode without a key, but not for local servers", () => {
    expect(getAIConfig({ AI_PROVIDER: "openai", AI_API_KEY: "" }).provider).toBe("mock");
    expect(getAIConfig({ AI_PROVIDER: "local", AI_API_KEY: "" }).provider).toBe("local");
    const openrouter = getAIConfig({ AI_PROVIDER: "openrouter", AI_API_KEY: "k", AI_MODEL: "a", AI_MODEL_STRONG: "b" });
    expect(openrouter).toMatchObject({ baseURL: "https://openrouter.ai/api/v1", models: { fast: "a", strong: "b" } });
    // The AI Gateway needs no key on Vercel (OIDC) and uses "provider/model" IDs.
    expect(getAIConfig({ AI_PROVIDER: "gateway" })).toMatchObject({
      provider: "gateway",
      models: { fast: "openai/gpt-4.1-mini", embedding: "openai/text-embedding-3-small" },
    });
  });
});

describe("helpers", () => {
  it("slugify keeps Korean and collapses symbols", () => {
    expect(slugify("AI & LLM")).toBe("ai-and-llm");
    expect(slugify("마케팅 자동화!")).toBe("마케팅-자동화");
  });
  it("mock embeddings are unit length and deterministic", () => {
    const v = mockEmbed("parallel coding agents");
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(mockEmbed("parallel coding agents")).toEqual(v);
  });
});
