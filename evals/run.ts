import { evaluateSpec, type ExtractedFacts, type SetupSpec } from "@aop-inbox/core";
import { mockIntent } from "@/lib/ai/mock";
import { factsFromDraft, type SpecDraft, type StepDraft } from "@/lib/actions/llm-schemas";
import { mockExtractFacts, mockStructure } from "@/lib/actions/mock-actions";
import { draftToSpec } from "@/lib/actions/postprocess";
import fixtures from "./fixtures.json";

/**
 * Golden set for the action layer. Content fixtures run through the whole
 * offline pipeline; draft fixtures inject a specific (bad) LLM output to show
 * the deterministic layer holds no matter what the model returns.
 * `pnpm eval` prints a report; tests/unit/evals.test.ts asserts it.
 */

type Expect = {
  intent?: string;
  decision?: string;
  risk?: string;
  stepTypes?: string[];
  mustNotRun?: string[];
  suspicious?: boolean;
  noSpec?: boolean;
  noSecrets?: boolean;
  needsUser?: boolean;
  guide?: boolean;
  chained?: boolean;
  verify?: boolean;
  usageHint?: boolean;
};
type Fixture = {
  id: string;
  kind: string;
  content?: string;
  facts?: Partial<ExtractedFacts>;
  draft?: { steps: (Partial<StepDraft> & { change?: Partial<NonNullable<StepDraft["change"]>> })[] };
  expect: Expect;
};

export interface EvalResult {
  id: string;
  kind: string;
  passed: boolean;
  failures: string[];
  decision: string;
  steps: number;
}

const emptyFacts: ExtractedFacts = { speech: [], screenText: [], toolsMentioned: [], commands: [], links: [], accountRequirements: [], suspiciousInstructions: [] };

function fillStep(s: Fixture["draft"] extends infer D ? (D extends { steps: (infer S)[] } ? S : never) : never, i: number): StepDraft {
  return {
    id: s.id ?? `s${i}`,
    title: s.title ?? s.id ?? "Step",
    type: s.type ?? "command",
    instruction: s.instruction ?? "Do it",
    commands: s.commands ?? [],
    target: null,
    needsUser: s.needsUser ?? false,
    risk: s.risk ?? "low",
    confidence: s.confidence ?? 0.9,
    evidenceQuote: s.evidenceQuote ?? null,
    evidenceSource: "screen",
    evidenceTimestampSec: null,
    verifyRecipe: null,
    verifyArgs: [],
    dependsOn: s.dependsOn ?? [],
    mcp: null,
    change: s.change ? { kind: s.change.kind ?? "file_write", path: s.change.path ?? "", jsonValue: s.change.jsonValue ?? null, content: s.change.content ?? null, line: s.change.line ?? null } : null,
    version: null,
    explain: { whatItDoes: "", whyNeeded: "", whatChanges: "", howToUndo: "" },
  };
}

export function runFixture(f: Fixture): EvalResult & { spec: SetupSpec | null } {
  const failures: string[] = [];
  const source = { itemId: f.id, platform: "eval" };
  let spec: SetupSpec | null = null;
  let intent: string | undefined;

  if (f.content) {
    intent = mockIntent(f.content).contentIntent;
    const facts = factsFromDraft(mockExtractFacts(f.content));
    const actionable = facts.commands.length || facts.accountRequirements.length || facts.guideGate;
    if (actionable && intent !== "knowledge" && intent !== "reference") spec = draftToSpec(mockStructure(facts, { title: f.id }), facts, source).spec;
  } else if (f.draft) {
    const facts = { ...emptyFacts, ...f.facts } as ExtractedFacts;
    const draft: SpecDraft = { contentType: "executable", summary: f.id, knowledge: [], usageHint: null, guideRequired: null, steps: f.draft.steps.map(fillStep) };
    spec = draftToSpec(draft, facts, source).spec;
  }

  const policy = spec ? evaluateSpec(spec, { autoRunLow: false }) : null;
  const decision = policy?.decision ?? "none";
  const e = f.expect;
  if (e.intent && intent !== e.intent) failures.push(`intent ${intent} ≠ ${e.intent}`);
  if (e.noSpec && spec) failures.push("expected no setup spec");
  if (e.decision && decision !== e.decision) failures.push(`decision ${decision} ≠ ${e.decision}`);
  if (e.risk && policy?.risk !== e.risk) failures.push(`risk ${policy?.risk} ≠ ${e.risk}`);
  if (e.stepTypes) {
    const types = new Set(spec?.steps.map((s) => s.type));
    for (const t of e.stepTypes) if (!types.has(t as never)) failures.push(`missing step type ${t}`);
  }
  if (e.suspicious && !spec?.suspiciousInstructions.length) failures.push("suspicious instructions not recorded");
  if (e.noSecrets && /ghp_[A-Za-z0-9]{10}/.test(JSON.stringify(spec))) failures.push("secret leaked into the spec");
  if (e.needsUser && !spec?.steps.some((s) => s.needsUser)) failures.push("no step hands control to the person");
  if (e.guide && !spec?.guideRequired) failures.push("guide gate not detected");
  if (e.chained && !spec?.steps.slice(1).every((s) => s.dependsOn.length > 0)) failures.push("steps are not chained with dependsOn");
  if (e.verify && !spec?.steps.some((s) => s.verify)) failures.push("no verification recipe chosen");
  if (e.usageHint && !spec?.usageHint) failures.push("no usage hint");
  // Security invariant: nothing matching mustNotRun may be runnable (auto or approve).
  for (const needle of e.mustNotRun ?? []) {
    const runnable = spec?.steps.filter((s) => ["auto", "approve"].includes(policy!.steps.find((p) => p.stepId === s.id)!.decision)) ?? [];
    if (runnable.some((s) => JSON.stringify([s.commands, s.mcp, s.change]).includes(needle))) failures.push(`“${needle}” would be runnable`);
  }
  return { id: f.id, kind: f.kind, passed: failures.length === 0, failures, decision, steps: spec?.steps.length ?? 0, spec };
}

export function runEvals(): EvalResult[] {
  return (fixtures as Fixture[]).map((f) => {
    const { spec: _spec, ...rest } = runFixture(f);
    void _spec;
    return rest;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runEvals();
  for (const r of results) process.stdout.write(`${r.passed ? "PASS" : "FAIL"}  ${r.id.padEnd(20)} ${r.kind.padEnd(26)} decision=${r.decision.padEnd(12)} steps=${r.steps}${r.failures.length ? `\n      ${r.failures.join("\n      ")}` : ""}\n`);
  const failed = results.filter((r) => !r.passed).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
}
