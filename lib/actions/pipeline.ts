import "server-only";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { evaluateSpec, redactSecrets, SPEC_VERSION, type ExtractedFacts, type SetupSpec } from "@aop-inbox/core";
import { actionAnalysisCache, items, setupSpecs, type Item } from "@/db/schema";
import { EXTRACT_FACTS_VERSION } from "@/lib/ai/prompts/extract-facts";
import { STRUCTURE_SETUP_VERSION } from "@/lib/ai/prompts/structure-setup";
import { extractFacts, structureSetup } from "@/lib/ai/services";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { reembedItem } from "@/lib/ingestion/pipeline";
import { factsDraftSchema, factsFromDraft } from "./llm-schemas";
import { draftToSpec } from "./postprocess";
import { syncItemActionState } from "./state";

/**
 * UNTRUSTED CONTENT → Stage 1 facts (cached per content) → Stage 2 draft (facts only)
 * → deterministic post-processing → SetupSpec validation → policy preview → revision.
 * Nothing here executes anything; execution starts only from a user action in lib/execution.
 */

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const ACTION_INTENTS = new Set(["actionable", "executable", "requires_user"]);

export function enqueueActionExtraction(itemId: string) {
  return enqueue({ type: "extract_actions", itemId, idempotencyKey: `extract_actions:${itemId}` });
}

async function contentFor(item: Item): Promise<string> {
  // Creator guides attached to this item are part of its evidence.
  const guides = await db.select().from(items).where(eq(items.parentItemId, item.id));
  const parts = [
    item.originalTitle,
    item.description,
    item.contentText,
    ...guides.map((g) => [`Attached guide: ${g.originalTitle ?? g.aiTitle ?? ""}`, g.contentText ?? g.description ?? g.userNote ?? ""].join("\n")),
  ];
  return redactSecrets(parts.filter(Boolean).join("\n\n")).slice(0, 20_000);
}

function emptyFacts(): ExtractedFacts {
  return { speech: [], screenText: [], toolsMentioned: [], commands: [], links: [], accountRequirements: [], suspiciousInstructions: [] };
}

function mergeFacts(a: ExtractedFacts, b: ExtractedFacts): ExtractedFacts {
  const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  return {
    title: a.title ?? b.title,
    creator: a.creator ?? b.creator,
    speech: [...a.speech, ...b.speech].slice(0, 50),
    screenText: [...a.screenText, ...b.screenText].slice(0, 50),
    toolsMentioned: uniq([...a.toolsMentioned, ...b.toolsMentioned], (x) => x.toLowerCase()).slice(0, 30),
    commands: uniq([...a.commands, ...b.commands], (c) => c.text).slice(0, 30),
    links: uniq([...a.links, ...b.links], (x) => x).slice(0, 30),
    accountRequirements: uniq([...a.accountRequirements, ...b.accountRequirements], (x) => x).slice(0, 10),
    guideGate: a.guideGate ?? b.guideGate,
    suspiciousInstructions: uniq([...a.suspiciousInstructions, ...b.suspiciousInstructions], (x) => x).slice(0, 20),
  };
}

/** Stage 1 for the shared content, cached by canonical URL + content hash + prompt/schema versions (no user data in the key's content). */
async function contentFacts(item: Item, text: string): Promise<{ facts: ExtractedFacts; model: string }> {
  if (!text.trim()) return { facts: emptyFacts(), model: "none" };
  const cacheKey = sha([item.canonicalUrl ?? `item:${item.id}`, sha(text), EXTRACT_FACTS_VERSION, SPEC_VERSION].join("|"));
  const cached = await db.query.actionAnalysisCache.findFirst({ where: eq(actionAnalysisCache.cacheKey, cacheKey) });
  if (cached) {
    const parsed = factsDraftSchema.safeParse(cached.facts);
    if (parsed.success) return { facts: factsFromDraft(parsed.data), model: cached.model };
  }
  const { facts, model } = await extractFacts({ source: "document", text, title: item.originalTitle, creator: item.creatorName }, item.userId);
  await db.insert(actionAnalysisCache).values({ cacheKey, facts, model }).onConflictDoNothing();
  return { facts: factsFromDraft(facts), model };
}

const hasActionFacts = (f: ExtractedFacts) => f.commands.length > 0 || f.accountRequirements.length > 0 || Boolean(f.guideGate);

export interface ExtractionOutcome {
  specId: string | null;
  revision: number | null;
  created: boolean;
}

export async function extractActionsForItem(itemId: string): Promise<ExtractionOutcome> {
  const item = await db.query.items.findFirst({ where: eq(items.id, itemId) });
  if (!item) return { specId: null, revision: null, created: false };

  const text = await contentFor(item);
  const content = await contentFacts(item, text);
  // The owner's note is extracted separately and never written to the shared cache.
  const note = item.userNote?.trim()
    ? factsFromDraft((await extractFacts({ source: "note", text: redactSecrets(item.userNote) }, item.userId)).facts)
    : emptyFacts();
  const facts = mergeFacts(content.facts, note);

  const specKey = sha([sha(text), sha(item.userNote ?? ""), EXTRACT_FACTS_VERSION, STRUCTURE_SETUP_VERSION, SPEC_VERSION].join("|"));
  const [latest] = await db.select().from(setupSpecs).where(eq(setupSpecs.itemId, itemId)).orderBy(desc(setupSpecs.revision)).limit(1);
  if (latest?.contentHash === specKey) {
    await syncItemActionState(itemId);
    return { specId: latest.id, revision: latest.revision, created: false };
  }

  const source: SetupSpec["source"] = {
    itemId,
    platform: item.sourceType,
    url: item.canonicalUrl ?? undefined,
    creator: item.creatorName ?? undefined,
    title: (item.aiTitle ?? item.originalTitle ?? undefined)?.slice(0, 300),
  };

  let spec: SetupSpec;
  let model = content.model;
  if (!hasActionFacts(facts)) {
    // Cost control: nothing to structure, so skip the strong model entirely.
    spec = { specVersion: SPEC_VERSION, source, contentType: "knowledge", summary: "Nothing to set up here.", steps: [], suspiciousInstructions: facts.suspiciousInstructions };
  } else {
    const structured = await structureSetup({ facts, title: source.title, platform: item.sourceType, creator: item.creatorName }, item.userId);
    model = structured.model;
    const { spec: built, report } = draftToSpec(structured.draft, facts, source);
    spec = built;
    if (report.droppedCommands.length || report.downgradedSteps.length) {
      log.warn("actions.unbacked_plan_content", { itemId, droppedCommands: report.droppedCommands.length, downgradedSteps: report.downgradedSteps.length });
    }
  }

  const policy = evaluateSpec(spec, { autoRunLow: false });
  const revision = (latest?.revision ?? 0) + 1;
  const [row] = await db
    .insert(setupSpecs)
    .values({
      userId: item.userId,
      itemId,
      revision,
      specVersion: SPEC_VERSION,
      promptVersion: STRUCTURE_SETUP_VERSION,
      model,
      spec,
      policy,
      contentHash: specKey,
    })
    .returning({ id: setupSpecs.id });

  await syncItemActionState(itemId);
  // The searchable digest changed — refresh the embedding (skipped when the doc hash is unchanged).
  await reembedItem(itemId);
  if (spec.steps.length) await track(item.userId, "action_detected", { itemId, props: { steps: spec.steps.length, risk: policy.risk, decision: policy.decision } });
  log.info("actions.spec_created", { itemId, revision, steps: spec.steps.length, decision: policy.decision });
  return { specId: row.id, revision, created: true };
}
