import {
  ChangeSchema,
  containsSecret,
  parseCommand,
  redactSecrets,
  SetupSpecSchema,
  SPEC_VERSION,
  validateRecipeArgs,
  type ExtractedFacts,
  type SetupSpec,
  type SetupStep,
} from "@aop-inbox/core";
import type { SpecDraft, StepDraft } from "./llm-schemas";

/**
 * Deterministic gate between the structuring model and the SetupSpec. The LLM
 * draft is untrusted too: every command must be found verbatim in the
 * extracted facts, every evidence quote must exist in them, secrets are
 * stripped, and whatever can't be backed up is downgraded to a user action.
 */

const norm = (s: string) => s.normalize("NFKC").replace(/^\s*\$\s*/, "").replace(/\s+/g, " ").trim();
const fold = (s: string) => norm(s).toLowerCase();

/** Fact commands plus the individual parts of chains, so a plan may split `a && b`. */
function allowedCommands(facts: ExtractedFacts): Set<string> {
  const allowed = new Set<string>();
  for (const c of facts.commands) {
    const text = norm(c.text);
    allowed.add(text);
    for (const part of text.split(/\s*(?:&&|\|\||;)\s*/)) if (part) allowed.add(part);
  }
  return allowed;
}

function corpus(facts: ExtractedFacts): string {
  return fold(
    [
      ...facts.commands.map((c) => c.text),
      ...facts.speech.map((s) => s.text),
      ...facts.screenText.map((s) => s.text),
      ...facts.accountRequirements,
      ...facts.links,
      ...facts.toolsMentioned,
      facts.guideGate?.quote ?? "",
      facts.title ?? "",
    ].join("\n"),
  );
}

const MIN_QUOTE = 6;

export interface PostprocessReport {
  droppedCommands: string[];
  downgradedSteps: string[];
  droppedEvidence: string[];
  redacted: boolean;
}

function slugId(raw: string, used: Set<string>): string {
  const base = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 40) || "step";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
}

function toUserAction(step: SetupStep, why: string): SetupStep {
  return {
    ...step,
    type: "user_action",
    needsUser: true,
    commands: [],
    change: undefined,
    mcp: undefined,
    verify: undefined,
    instruction: `${step.instruction}${why ? ` (${why})` : ""}`.slice(0, 1200),
  };
}

function convertStep(d: StepDraft, ctx: { allowed: Set<string>; text: string; idMap: Map<string, string>; used: Set<string>; report: PostprocessReport }): SetupStep {
  const id = slugId(d.id || d.title, ctx.used);
  ctx.idMap.set(d.id, id);

  // Evidence must be findable in the facts; otherwise it doesn't count.
  let evidence: SetupStep["evidence"];
  if (d.evidenceQuote && d.evidenceQuote.trim().length >= MIN_QUOTE && ctx.text.includes(fold(d.evidenceQuote))) {
    evidence = { quote: redactSecrets(d.evidenceQuote.trim()).slice(0, 500), source: d.evidenceSource ?? undefined, timestampSec: d.evidenceTimestampSec ?? undefined };
  } else if (d.evidenceQuote) ctx.report.droppedEvidence.push(id);

  // Commands: verbatim from facts only.
  const commands: string[] = [];
  let hadSecret = false;
  for (const raw of d.commands) {
    const c = norm(raw);
    if (!ctx.allowed.has(c)) {
      ctx.report.droppedCommands.push(c);
      continue;
    }
    if (containsSecret(c)) {
      hadSecret = true;
      ctx.report.redacted = true;
    }
    commands.push(redactSecrets(c));
  }

  // MCP definition: every token must appear in an allowed command.
  let mcp: SetupStep["mcp"];
  if (d.mcp) {
    const tokens = new Set([...ctx.allowed].flatMap((c) => parseCommand(c).segments.flatMap((s) => s.argv)));
    const needed = [d.mcp.name, d.mcp.commandOrUrl, ...d.mcp.args];
    if (needed.every((t) => tokens.has(t))) {
      mcp = { ...d.mcp, envKeys: d.mcp.envKeys.filter((k) => /^[A-Z_][A-Z0-9_]*$/.test(k)) };
    } else ctx.report.droppedCommands.push(`mcp:${d.mcp.name}`);
  }

  // Structured file change: needs evidence and must be well-formed.
  let change: SetupStep["change"];
  if (d.change && evidence) {
    let candidate: unknown = null;
    if (d.change.kind === "json_merge") {
      try {
        candidate = { kind: "json_merge", path: d.change.path, value: JSON.parse(d.change.jsonValue ?? "null") };
      } catch {
        candidate = null;
      }
    } else if (d.change.kind === "file_write") candidate = { kind: "file_write", path: d.change.path, content: d.change.content ?? "" };
    else candidate = { kind: "append_line", path: d.change.path, line: d.change.line ?? "" };
    const parsed = ChangeSchema.safeParse(candidate);
    if (parsed.success && !containsSecret(JSON.stringify(parsed.data))) change = parsed.data;
  }

  const verify =
    d.verifyRecipe && validateRecipeArgs(d.verifyRecipe, Object.fromEntries(d.verifyArgs.map((a) => [a.key, a.value]))).ok
      ? { recipe: d.verifyRecipe, args: Object.fromEntries(d.verifyArgs.map((a) => [a.key, a.value])) }
      : undefined;

  let step: SetupStep = {
    id,
    title: redactSecrets(d.title).slice(0, 120) || "Step",
    type: d.type,
    instruction: redactSecrets(d.instruction).slice(0, 1200) || d.title,
    commands,
    target: d.target ? redactSecrets(d.target) : undefined,
    needsUser: d.needsUser || hadSecret,
    risk: d.risk,
    confidence: Math.max(0, Math.min(1, d.confidence)),
    evidence,
    verify,
    dependsOn: d.dependsOn,
    change,
    mcp,
    version: d.version ?? undefined,
    explain: {
      whatItDoes: redactSecrets(d.explain.whatItDoes).slice(0, 240),
      whyNeeded: redactSecrets(d.explain.whyNeeded).slice(0, 240),
      whatChanges: redactSecrets(d.explain.whatChanges).slice(0, 240),
      howToUndo: redactSecrets(d.explain.howToUndo).slice(0, 240),
    },
  };

  const needsCommands = step.type === "cli_install" || step.type === "command";
  const lostBacking =
    (needsCommands && step.commands.length === 0) ||
    (step.type === "mcp_add" && !step.mcp) ||
    ((step.type === "config_write" || step.type === "file_create") && !step.change);
  if (step.type !== "user_action" && lostBacking) {
    ctx.report.downgradedSteps.push(id);
    step = toUserAction(step, "AOP Inbox couldn't confirm the exact command in the source");
  }
  if (hadSecret && step.type !== "user_action") step = { ...step, needsUser: true };
  return step;
}

export function draftToSpec(
  draft: SpecDraft,
  facts: ExtractedFacts,
  source: SetupSpec["source"],
): { spec: SetupSpec; report: PostprocessReport } {
  const report: PostprocessReport = { droppedCommands: [], downgradedSteps: [], droppedEvidence: [], redacted: false };
  const ctx = { allowed: allowedCommands(facts), text: corpus(facts), idMap: new Map<string, string>(), used: new Set<string>(), report };
  const converted = draft.steps.slice(0, 20).map((d) => convertStep(d, ctx));

  // Re-map dependencies to final ids, keeping only earlier steps.
  const seen = new Set<string>();
  const steps = converted.map((s) => {
    const deps = s.dependsOn.map((d) => ctx.idMap.get(d) ?? d).filter((d) => seen.has(d) && d !== s.id);
    seen.add(s.id);
    return { ...s, dependsOn: [...new Set(deps)] };
  });

  const runnable = steps.some((s) => s.type !== "user_action");
  const contentType: SetupSpec["contentType"] =
    steps.length === 0 && !facts.guideGate ? "knowledge" : runnable ? (draft.contentType === "knowledge" ? "executable" : draft.contentType) : "needs_account";

  const guide = draft.guideRequired ?? (facts.guideGate ? { keyword: facts.guideGate.keyword ?? null, instructions: "The creator shares the guide on request." } : null);
  const spec = SetupSpecSchema.parse({
    specVersion: SPEC_VERSION,
    source,
    contentType,
    summary: redactSecrets(draft.summary).slice(0, 600) || "Setup",
    knowledge: draft.knowledge.map((k) => redactSecrets(k).slice(0, 300)).slice(0, 10),
    steps,
    usageHint: draft.usageHint ? redactSecrets(draft.usageHint).slice(0, 300) : undefined,
    suspiciousInstructions: facts.suspiciousInstructions.map((s) => redactSecrets(s).slice(0, 500)).slice(0, 20),
    guideRequired: guide ? { keyword: guide.keyword ?? undefined, instructions: guide.instructions.slice(0, 400) } : undefined,
  });
  return { spec, report };
}
