import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany, generateText, Output, streamText, type LanguageModelUsage } from "ai";
import { aiUsage, EMBEDDING_DIMENSIONS } from "@/db/schema";
import { db } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";
import { getAIConfig, type AIConfig } from "./config";
import { mockAnalyze, mockEmbed } from "./mock";
import { ANALYZE_ITEM_VERSION, analyzeItemInstructions, analyzeItemPrompt, type AnalyzeItemInput } from "./prompts/analyze-item";
import { EXTRACT_FACTS_VERSION, extractFactsInstructions, extractFactsPrompt } from "./prompts/extract-facts";
import { STRUCTURE_SETUP_VERSION, structureSetupInstructions, structureSetupPrompt } from "./prompts/structure-setup";
import { factsDraftSchema, specDraftSchema, type FactsDraft, type SpecDraft } from "@/lib/actions/llm-schemas";
import { mockExtractFacts, mockStructure } from "@/lib/actions/mock-actions";
import type { ExtractedFacts } from "@aop-inbox/core";
import { askInboxInstructions, askInboxPrompt, type AskContextItem } from "./prompts/ask-inbox";
import { itemAnalysisSchema, type ItemAnalysis } from "./schemas";

/**
 * The only module that talks to an LLM. Everything else calls these functions,
 * so swapping vendors / models is a config change (see lib/ai/config.ts).
 */

function sdk(config: AIConfig) {
  return createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseURL,
    apiKey: config.apiKey || undefined,
    supportsStructuredOutputs: config.provider === "openai",
    includeUsage: true,
  });
}

// USD per 1M tokens [input, output]. Override with AI_PRICES='{"model":[in,out]}'. Unknown models log no cost.
const DEFAULT_PRICES: Record<string, [number, number]> = {
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1": [2, 8],
  "gpt-4.1-nano": [0.1, 0.4],
  "text-embedding-3-small": [0.02, 0],
  "text-embedding-3-large": [0.13, 0],
};

function estimateCost(model: string, input?: number, output?: number): number | undefined {
  let prices = DEFAULT_PRICES;
  try {
    if (process.env.AI_PRICES) prices = { ...DEFAULT_PRICES, ...(JSON.parse(process.env.AI_PRICES) as typeof DEFAULT_PRICES) };
  } catch {
    // ignore malformed override
  }
  const p = prices[model] ?? prices[model.split("/").pop() ?? ""];
  if (!p || input === undefined) return undefined;
  return (input * p[0] + (output ?? 0) * p[1]) / 1_000_000;
}

async function recordUsage(entry: {
  userId?: string;
  operation: string;
  model: string;
  startedAt: number;
  success: boolean;
  promptVersion?: number;
  usage?: Partial<LanguageModelUsage> | { tokens?: number };
}) {
  const latencyMs = Date.now() - entry.startedAt;
  const usage = entry.usage as { inputTokens?: number; outputTokens?: number; tokens?: number } | undefined;
  const inputTokens = usage?.inputTokens ?? usage?.tokens;
  const provider = getAIConfig().provider;
  const estimatedCostUsd = estimateCost(entry.model, inputTokens, usage?.outputTokens);
  log.info("ai.call", { operation: entry.operation, provider, model: entry.model, latencyMs, success: entry.success, inputTokens, outputTokens: usage?.outputTokens, estimatedCostUsd });
  try {
    await db.insert(aiUsage).values({
      userId: entry.userId,
      operation: entry.operation,
      provider,
      model: entry.model,
      promptVersion: entry.promptVersion,
      estimatedCostUsd,
      inputTokens,
      outputTokens: usage?.outputTokens,
      latencyMs,
      success: entry.success,
    });
  } catch (error) {
    log.warn("ai.usage_write_failed", { error: errorMessage(error) });
  }
}

export interface AnalysisResult {
  analysis: ItemAnalysis;
  model: string;
}

export async function analyzeItem(input: AnalyzeItemInput, userId?: string): Promise<AnalysisResult> {
  const config = getAIConfig();
  const model = config.models.fast;
  if (config.provider === "mock") return { analysis: mockAnalyze(input), model };

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: sdk(config).chatModel(model),
      instructions: analyzeItemInstructions,
      prompt: analyzeItemPrompt(input),
      output: Output.object({ schema: itemAnalysisSchema }),
      maxRetries: 2,
      temperature: 0.2,
    });
    await recordUsage({ userId, operation: "analyze_item", model, startedAt, success: true, usage: result.usage, promptVersion: ANALYZE_ITEM_VERSION });
    return { analysis: result.output, model };
  } catch (error) {
    await recordUsage({ userId, operation: "analyze_item", model, startedAt, success: false });
    throw error;
  }
}

export function embeddingModelId(): string {
  return getAIConfig().models.embedding;
}

export async function embedTexts(values: string[], operation: string, userId?: string): Promise<number[][]> {
  const config = getAIConfig();
  const model = config.models.embedding;
  if (config.provider === "mock") return values.map(mockEmbed);

  const startedAt = Date.now();
  try {
    const result = await embedMany({
      model: sdk(config).embeddingModel(model),
      values,
      maxRetries: 2,
      // Asks the provider for exactly our column size (OpenAI v3 models support this).
      providerOptions: { [config.provider]: { dimensions: EMBEDDING_DIMENSIONS } },
    });
    await recordUsage({ userId, operation, model, startedAt, success: true, usage: result.usage });
    const wrong = result.embeddings.find((e) => e.length !== EMBEDDING_DIMENSIONS);
    if (wrong) throw new Error(`Embedding model returned ${wrong.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`);
    return result.embeddings;
  } catch (error) {
    await recordUsage({ userId, operation, model, startedAt, success: false });
    throw error;
  }
}

/** Streams an answer grounded in the given items. Yields text chunks. */
export async function* streamAnswer(question: string, items: AskContextItem[], userId?: string): AsyncGenerator<string> {
  const config = getAIConfig();
  if (config.provider === "mock") {
    yield* mockAnswer(question, items);
    return;
  }
  if (items.length === 0) {
    yield "I couldn't find anything in your inbox about that yet. Try different words, or save a few items on the topic first.";
    return;
  }
  const model = config.models.strong;
  const startedAt = Date.now();
  const result = streamText({
    model: sdk(config).chatModel(model),
    instructions: askInboxInstructions,
    prompt: askInboxPrompt(question, items),
    temperature: 0.3,
    maxRetries: 1,
  });
  let success = false;
  try {
    for await (const chunk of result.textStream) yield chunk;
    success = true;
  } finally {
    await recordUsage({ userId, operation: "ask_inbox", model, startedAt, success, usage: success ? await result.usage : undefined });
  }
}

async function* mockAnswer(question: string, items: AskContextItem[]): AsyncGenerator<string> {
  if (items.length === 0) {
    yield "I couldn't find anything in your inbox about that yet. Try different words, or save a few items on the topic first.";
    return;
  }
  yield `_Offline mode — add an AI key for synthesized answers. Here is what your inbox has on “${question.slice(0, 80)}”:_\n\n`;
  for (const it of items.slice(0, 6)) {
    yield `- **${it.title}** — ${it.userNote || it.summary || "No summary yet."} [${it.index}]\n`;
  }
}

/* ─── Action layer: two isolated stages ────────────────────────────────── */

/** Stage 1 — facts from untrusted content. Cheap model; content wrapped as data. */
export async function extractFacts(
  input: { source: "document" | "note"; text: string; title?: string | null; creator?: string | null },
  userId?: string,
): Promise<{ facts: FactsDraft; model: string }> {
  const config = getAIConfig();
  const model = config.models.fast;
  if (config.provider === "mock") return { facts: mockExtractFacts(input.text, input.source), model };
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: sdk(config).chatModel(model),
      instructions: extractFactsInstructions,
      prompt: extractFactsPrompt(input),
      output: Output.object({ schema: factsDraftSchema }),
      maxRetries: 2,
      temperature: 0,
    });
    await recordUsage({ userId, operation: "extract_facts", model, startedAt, success: true, usage: result.usage, promptVersion: EXTRACT_FACTS_VERSION });
    return { facts: result.output, model };
  } catch (error) {
    await recordUsage({ userId, operation: "extract_facts", model, startedAt, success: false, promptVersion: EXTRACT_FACTS_VERSION });
    throw error;
  }
}

/** Stage 2 — plan from FACTS only (never the raw content). Strong model. */
export async function structureSetup(
  input: { facts: ExtractedFacts; title?: string | null; platform: string; creator?: string | null },
  userId?: string,
): Promise<{ draft: SpecDraft; model: string }> {
  const config = getAIConfig();
  const model = config.models.strong;
  if (config.provider === "mock") return { draft: mockStructure(input.facts, { title: input.title }), model };
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: sdk(config).chatModel(model),
      instructions: structureSetupInstructions,
      prompt: structureSetupPrompt(input),
      output: Output.object({ schema: specDraftSchema }),
      maxRetries: 2,
      temperature: 0,
    });
    await recordUsage({ userId, operation: "structure_setup", model, startedAt, success: true, usage: result.usage, promptVersion: STRUCTURE_SETUP_VERSION });
    return { draft: result.output, model };
  } catch (error) {
    await recordUsage({ userId, operation: "structure_setup", model, startedAt, success: false, promptVersion: STRUCTURE_SETUP_VERSION });
    throw error;
  }
}
