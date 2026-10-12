import { RISK_LEVELS, STEP_TYPES, type ExtractedFacts } from "@aop-inbox/core";
import { z } from "zod";

/**
 * What the LLM is asked to return. Flat, every field required (nullable instead
 * of optional) so it works with strict structured-output modes across
 * providers. Code converts these drafts into the real contracts.
 */

const text = (max: number) => z.string().max(max);

export const factsDraftSchema = z.object({
  title: text(300).nullable(),
  creator: text(200).nullable(),
  speech: z.array(z.object({ t: z.number().nullable(), text: text(1000) })).max(50),
  screenText: z.array(z.object({ t: z.number().nullable(), text: text(1000) })).max(50),
  toolsMentioned: z.array(text(80)).max(30),
  commands: z.array(z.object({ t: z.number().nullable(), text: text(600), source: z.enum(["screen", "speech", "document"]) })).max(30),
  links: z.array(text(2048)).max(30),
  accountRequirements: z.array(text(200)).max(10),
  guideGate: z.object({ keyword: text(60).nullable(), quote: text(300) }).nullable(),
  suspiciousInstructions: z.array(text(500)).max(20),
});
export type FactsDraft = z.infer<typeof factsDraftSchema>;

export function factsFromDraft(d: FactsDraft): ExtractedFacts {
  const nn = <T,>(v: T | null) => v ?? undefined;
  return {
    title: nn(d.title),
    creator: nn(d.creator),
    speech: d.speech.map((s) => ({ t: nn(s.t), text: s.text })),
    screenText: d.screenText.map((s) => ({ t: nn(s.t), text: s.text })),
    toolsMentioned: d.toolsMentioned,
    commands: d.commands.map((c) => ({ t: nn(c.t), text: c.text, source: c.source })),
    links: d.links,
    accountRequirements: d.accountRequirements,
    guideGate: d.guideGate ? { keyword: nn(d.guideGate.keyword), quote: d.guideGate.quote } : undefined,
    suspiciousInstructions: d.suspiciousInstructions,
  };
}

export const stepDraftSchema = z.object({
  id: text(48),
  title: text(120),
  type: z.enum(STEP_TYPES),
  instruction: text(1200),
  commands: z.array(text(600)).max(10),
  target: text(400).nullable(),
  needsUser: z.boolean(),
  risk: z.enum(RISK_LEVELS),
  confidence: z.number().min(0).max(1),
  evidenceQuote: text(500).nullable(),
  evidenceSource: text(40).nullable(),
  evidenceTimestampSec: z.number().nullable(),
  verifyRecipe: text(40).nullable(),
  verifyArgs: z.array(z.object({ key: text(40), value: text(400) })).max(6),
  dependsOn: z.array(text(48)).max(10),
  mcp: z
    .object({
      name: text(64),
      transport: z.enum(["stdio", "http", "sse"]),
      commandOrUrl: text(400),
      args: z.array(text(400)).max(30),
      scope: z.enum(["local", "user", "project"]),
      envKeys: z.array(text(64)).max(20),
    })
    .nullable(),
  change: z
    .object({
      kind: z.enum(["json_merge", "file_write", "append_line"]),
      path: text(400),
      jsonValue: text(8000).nullable().describe("json_merge only: a JSON object as a string"),
      content: text(16000).nullable(),
      line: text(1000).nullable(),
    })
    .nullable(),
  version: text(40).nullable(),
  explain: z.object({ whatItDoes: text(240), whyNeeded: text(240), whatChanges: text(240), howToUndo: text(240) }),
});
export type StepDraft = z.infer<typeof stepDraftSchema>;

export const specDraftSchema = z.object({
  contentType: z.enum(["executable", "needs_account", "knowledge"]),
  summary: text(600),
  knowledge: z.array(text(300)).max(10),
  usageHint: text(300).nullable(),
  guideRequired: z.object({ keyword: text(60).nullable(), instructions: text(400) }).nullable(),
  steps: z.array(stepDraftSchema).max(20),
});
export type SpecDraft = z.infer<typeof specDraftSchema>;
