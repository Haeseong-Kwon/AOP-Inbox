export type AIProviderName = "openai" | "openrouter" | "local" | "mock";
export type ModelProfile = "fast" | "strong";

export interface AIConfig {
  provider: AIProviderName;
  apiKey: string;
  baseURL: string;
  models: { fast: string; strong: string; embedding: string };
}

const DEFAULT_BASE_URLS: Record<Exclude<AIProviderName, "mock">, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  local: "http://localhost:11434/v1",
};

export function getAIConfig(env: Record<string, string | undefined> = process.env): AIConfig {
  const requested = (env.AI_PROVIDER ?? "openai").toLowerCase() as AIProviderName;
  const apiKey = env.AI_API_KEY ?? "";
  // Without a key (local servers excepted) we fall back to the offline analyzer instead of failing every job.
  const provider: AIProviderName =
    requested === "mock" || (requested !== "local" && !apiKey) ? "mock" : (requested in DEFAULT_BASE_URLS ? requested : "openai");
  const fast = env.AI_MODEL || "gpt-4.1-mini";
  return {
    provider,
    apiKey,
    baseURL: env.AI_BASE_URL || (provider === "mock" ? "" : DEFAULT_BASE_URLS[provider]),
    models: {
      fast: provider === "mock" ? "mock-analyzer" : fast,
      strong: provider === "mock" ? "mock-analyzer" : env.AI_MODEL_STRONG || fast,
      embedding: provider === "mock" ? "mock-hash-1536" : env.AI_EMBEDDING_MODEL || "text-embedding-3-small",
    },
  };
}
