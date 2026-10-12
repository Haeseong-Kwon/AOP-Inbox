import { analyzeArgv, analyzeCommand, maxRisk, referencesSensitivePath } from "./command";
import type { FailureCode } from "./errors";
import { changeRisk } from "./changes";
import nodePath from "node:path";
import { classifyPath, isWithin, PREVIEW_PATHS, resolvePath, ZONE_RISK, type PathContext, type PathZone } from "./paths";
import type { Risk, SetupSpec, SetupStep } from "./setup-spec";

/**
 * The policy engine. Deterministic, no LLM involved: the model's own `risk`
 * label is only ever a floor — every rule here can raise it, nothing lowers it.
 * The server runs it to build the review; the device runs it again before
 * executing, with real filesystem resolution, and refuses on any mismatch.
 */

export const CONFIDENCE = { normal: 0.85, review: 0.7 } as const;

export type StepDecision = "auto" | "approve" | "manual" | "blocked";

export interface StepPolicy {
  stepId: string;
  risk: Risk;
  decision: StepDecision;
  reasons: string[];
  codes: FailureCode[];
  writes: { path: string; resolved: string; zone: PathZone }[];
  installs: string[];
  /** confidence between 0.70 and 0.85 — runs only after a person looks at it */
  reviewSuggested: boolean;
}

export type SpecDecision = "none" | "auto" | "approve" | "manual_only" | "blocked";

export interface SpecPolicy {
  risk: Risk;
  decision: SpecDecision;
  steps: StepPolicy[];
  requiresApproval: boolean;
  blockedReasons: string[];
}

export interface PolicyContext {
  /** user explicitly enabled low-risk auto-run on this device (default false) */
  autoRunLow: boolean;
  paths?: PathContext;
}

const significant = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9@._/~-]+/)
    .filter((t) => t.length > 3);

/** A step is linked to a suspicious instruction when they share a distinctive token or the step touches secrets. */
export function linkedToSuspicious(step: SetupStep, suspicious: string[]): boolean {
  if (suspicious.length === 0) return false;
  const stepText = [step.instruction, step.evidence?.quote ?? "", ...step.commands, step.change?.path ?? "", step.mcp?.commandOrUrl ?? ""].join(" ");
  if (referencesSensitivePath(stepText)) return true;
  const stepTokens = new Set(significant(stepText));
  return suspicious.some((s) => significant(s).some((t) => stepTokens.has(t) && !/^(the|this|that|with|from|your|install|setup|claude|code)$/.test(t)));
}

function mcpRisk(step: SetupStep, reasons: string[]): Risk {
  const mcp = step.mcp;
  if (!mcp) return "low";
  let risk: Risk = mcp.scope === "project" ? "low" : "medium";
  reasons.push(mcp.scope === "project" ? "Registers an MCP server for the workspace project" : "Changes your Claude Code configuration (~/.claude.json)");
  if (mcp.transport === "stdio") {
    // Analyzed as argv, exactly as it will be stored — no re-quoting.
    const analysis = analyzeArgv([mcp.commandOrUrl, ...mcp.args]);
    if (analysis.denied || analysis.risk === "high") {
      risk = "high";
      reasons.push(...analysis.reasons.map((r) => `MCP server command: ${r}`));
    } else {
      // A local MCP server runs a program every time Claude Code starts it.
      risk = maxRisk(risk, "medium");
      reasons.push(
        /^(npx|pnpx|bunx|uvx|pipx)$/.test(mcp.commandOrUrl)
          ? "The MCP server downloads and runs package code when Claude Code starts it"
          : "The MCP server runs a program whenever Claude Code starts it",
      );
    }
  } else if (!/^https:\/\//.test(mcp.commandOrUrl)) {
    risk = "high";
    reasons.push("Remote MCP server isn't served over HTTPS");
  }
  if (mcp.envKeys.length) reasons.push(`Needs your ${mcp.envKeys.join(", ")} — you enter it yourself`);
  return risk;
}

export function evaluateStep(step: SetupStep, spec: Pick<SetupSpec, "suspiciousInstructions">, ctx: PolicyContext): StepPolicy {
  const paths = ctx.paths ?? PREVIEW_PATHS;
  const reasons: string[] = [];
  const codes: FailureCode[] = [];
  const writes: StepPolicy["writes"] = [];
  const installs: string[] = [];
  let risk: Risk = step.risk;
  let denied = false;
  let manual = step.needsUser || step.type === "user_action";

  for (const command of step.commands) {
    const analysis = analyzeCommand(command);
    risk = maxRisk(risk, analysis.risk);
    denied ||= analysis.denied;
    reasons.push(...analysis.reasons);
    installs.push(...analysis.installs);
    for (const w of analysis.writes) {
      const c = classifyPath(w, paths);
      writes.push({ path: w, ...c });
    }
  }
  if (step.change) {
    const c = classifyPath(step.change.path, paths);
    writes.push({ path: step.change.path, ...c });
    let rel: string | undefined;
    if (c.zone === "workspace") {
      for (const ws of [paths.workspace, ...(paths.extraWorkspaces ?? [])]) {
        const root = resolvePath(ws, paths, "/");
        if (isWithin(c.resolved, root)) {
          rel = nodePath.relative(root, c.resolved);
          break;
        }
      }
    }
    const content = changeRisk(step.change, c.zone, c.resolved, rel);
    risk = maxRisk(risk, content.risk);
    reasons.push(...content.reasons);
  }
  if (step.type === "mcp_add") risk = maxRisk(risk, mcpRisk(step, reasons));

  for (const w of writes) {
    risk = maxRisk(risk, ZONE_RISK[w.zone]);
    if (w.zone === "sensitive") {
      denied = true;
      reasons.push(`Writes to a protected location (${w.path})`);
    } else if (w.zone === "outside" || w.zone === "agent_state") {
      reasons.push(`Writes outside the allowed folders (${w.path})`);
    } else if (w.zone !== "workspace") {
      reasons.push(`Changes ${w.zone === "claude_config" ? "Claude Code settings" : "your shell profile"} (${w.path})`);
    }
  }

  if (linkedToSuspicious(step, spec.suspiciousInstructions)) {
    risk = "high";
    reasons.push("Connected to instructions in the content that look like an attempt to manipulate the AI");
  } else if (spec.suspiciousInstructions.length > 0 && !manual) {
    risk = maxRisk(risk, "medium");
    reasons.push("The source contains suspicious instructions, so every step needs your review");
  }

  const runsSomething = step.commands.length > 0 || step.change || step.mcp;
  if (runsSomething && !manual && !step.evidence?.quote) {
    manual = true;
    codes.push("LOW_CONFIDENCE");
    reasons.push("No quote from the source backs this step, so it's shown as instructions only");
  }
  if (step.confidence < CONFIDENCE.review && !manual) {
    manual = true;
    codes.push("LOW_CONFIDENCE");
    reasons.push(`Low confidence (${Math.round(step.confidence * 100)}%) — not run automatically`);
  }
  const reviewSuggested = step.confidence >= CONFIDENCE.review && step.confidence < CONFIDENCE.normal;
  if (reviewSuggested) reasons.push(`Moderate confidence (${Math.round(step.confidence * 100)}%) — review before running`);

  if (step.type === "cli_install" || step.type === "command") {
    if (step.commands.length === 0 && !manual) {
      manual = true;
      reasons.push("No concrete command to run");
    }
  }

  let decision: StepDecision;
  if (denied || risk === "high") {
    decision = "blocked";
    codes.push("POLICY_DENIED");
  } else if (manual) {
    decision = "manual";
    if (step.needsUser || step.type === "user_action") codes.push("USER_ACTION_REQUIRED");
  } else if (risk === "medium" || reviewSuggested || !ctx.autoRunLow) {
    decision = "approve";
  } else {
    decision = "auto";
  }
  return { stepId: step.id, risk, decision, reasons: [...new Set(reasons)], codes: [...new Set(codes)], writes, installs, reviewSuggested };
}

export function evaluateSpec(spec: SetupSpec, ctx: PolicyContext): SpecPolicy {
  const steps = spec.steps.map((s) => evaluateStep(s, spec, ctx));
  const risk = steps.reduce<Risk>((acc, s) => maxRisk(acc, s.risk), "low");
  const blocked = steps.filter((s) => s.decision === "blocked");
  let decision: SpecDecision;
  if (spec.contentType === "knowledge" || steps.length === 0) decision = "none";
  else if (blocked.length) decision = "blocked";
  else if (steps.every((s) => s.decision === "manual")) decision = "manual_only";
  else if (steps.some((s) => s.decision === "approve")) decision = "approve";
  else decision = "auto";
  return {
    risk,
    decision,
    steps,
    requiresApproval: decision === "approve",
    blockedReasons: blocked.flatMap((s) => s.reasons.map((r) => `${s.stepId}: ${r}`)),
  };
}
