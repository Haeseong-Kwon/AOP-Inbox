import { analyzeCommand } from "./command";
import type { Explain, PlannedAction, SetupSpec, SetupStep } from "./setup-spec";

/**
 * Plain-language explanation and a device-independent plan for each step. The
 * device's dry run replaces the plan with real diffs; this is what the review
 * screen and "Copy steps" show before (or without) a connected Mac.
 */

export function mcpCommand(step: SetupStep): string | null {
  const m = step.mcp;
  if (!m) return null;
  const parts = ["claude", "mcp", "add"];
  if (m.transport !== "stdio") parts.push("--transport", m.transport);
  if (m.scope !== "local") parts.push("-s", m.scope);
  for (const key of m.envKeys) parts.push("-e", `${key}=<your ${key}>`);
  parts.push(m.name);
  if (m.transport === "stdio") parts.push("--", m.commandOrUrl, ...m.args);
  else parts.push(m.commandOrUrl);
  return parts.map((p) => (/[\s"'$`\\]/.test(p) ? JSON.stringify(p) : p)).join(" ");
}

export function explainStep(step: SetupStep): Explain {
  if (step.explain) return step.explain;
  const analysis = step.commands.map(analyzeCommand);
  const installs = analysis.flatMap((a) => a.installs);
  switch (step.type) {
    case "mcp_add":
      return {
        whatItDoes: `Registers the “${step.mcp?.name ?? "MCP"}” server with Claude Code.`,
        whyNeeded: "Claude Code can only use tools from MCP servers it knows about.",
        whatChanges: step.mcp?.scope === "project" ? ".mcp.json in your AOP Inbox workspace" : "Your Claude Code settings in ~/.claude.json",
        howToUndo: `Remove it with: claude mcp remove ${step.mcp?.name ?? "<name>"}${step.mcp && step.mcp.scope !== "local" ? ` -s ${step.mcp.scope}` : ""}`,
      };
    case "cli_install":
      return {
        whatItDoes: installs.length ? `Installs ${installs.join(", ")}.` : step.instruction,
        whyNeeded: "Later steps depend on this tool being available.",
        whatChanges: analysis.some((a) => a.reasons.some((r) => r.includes("global"))) ? "Adds software to your machine" : "Adds a package to the workspace",
        howToUndo: installs.length ? `Uninstall ${installs.join(", ")} with the same package manager. Not undone automatically.` : "Uninstall it manually.",
      };
    case "config_write":
    case "file_create":
      return {
        whatItDoes:
          step.change?.kind === "json_merge"
            ? `Adds settings to ${step.change.path}.`
            : step.change?.kind === "append_line"
              ? `Adds one line to ${step.change.path}.`
              : `Writes ${step.change?.path ?? step.target ?? "a file"}.`,
        whyNeeded: step.instruction,
        whatChanges: step.change?.path ?? step.target ?? "One file",
        howToUndo: "AOP Inbox keeps a snapshot and restores the original file on Undo.",
      };
    case "user_action":
      return { whatItDoes: step.instruction, whyNeeded: "This needs a person — an account, a key or a choice.", whatChanges: "Nothing on your Mac", howToUndo: "Nothing to undo." };
    default:
      return {
        whatItDoes: step.instruction,
        whyNeeded: "Part of the setup described in the source.",
        whatChanges: analysis.some((a) => a.kind === "read_only") ? "Nothing — read-only check" : "Depends on the command",
        howToUndo: analysis.every((a) => a.kind === "read_only") ? "Nothing to undo." : "Not undone automatically.",
      };
  }
}

export function staticPlan(spec: SetupSpec): PlannedAction[] {
  return spec.steps.flatMap((step): PlannedAction[] => {
    if (step.needsUser || step.type === "user_action") {
      return [{ stepId: step.id, type: "user_action", description: step.instruction, reversible: "no" }];
    }
    if (step.type === "mcp_add" && step.mcp) {
      return [{ stepId: step.id, type: "mcp_register", description: `Register MCP server “${step.mcp.name}”`, command: mcpCommand(step) ?? undefined, reversible: "yes" }];
    }
    if (step.change) {
      return [{ stepId: step.id, type: "file_update", description: step.title, path: step.change.path, reversible: "yes" }];
    }
    return step.commands.map((command) => {
      const a = analyzeCommand(command);
      return {
        stepId: step.id,
        type: a.kind === "package_install" ? ("package_install" as const) : ("command" as const),
        description: step.title,
        command,
        reversible: a.kind === "read_only" ? ("yes" as const) : a.kind === "package_install" ? ("partial" as const) : ("no" as const),
      };
    });
  });
}

/** Plain-text checklist for "Copy steps" / manual mode. */
export function manualChecklist(spec: SetupSpec): string {
  const lines = [`# ${spec.source.title ?? spec.summary}`, ""];
  spec.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title}`);
    lines.push(`   ${step.instruction}`);
    const cmd = step.type === "mcp_add" ? mcpCommand(step) : null;
    for (const c of cmd ? [cmd] : step.commands) lines.push(`   $ ${c}`);
    lines.push("");
  });
  if (spec.usageHint) lines.push(`Try it: ${spec.usageHint}`);
  return lines.join("\n").trim() + "\n";
}

/** Paths two specs both touch → "Potential conflict". */
export function touchedTargets(spec: SetupSpec): string[] {
  const targets = new Set<string>();
  for (const step of spec.steps) {
    if (step.change) targets.add(step.change.path.replace(/^\$HOME/, "~"));
    if (step.mcp) targets.add(step.mcp.scope === "project" ? ".mcp.json" : `~/.claude.json#mcp:${step.mcp.name}`);
    for (const c of step.commands) for (const w of analyzeCommand(c).writes) targets.add(w.replace(/^\$HOME/, "~"));
  }
  return [...targets];
}
