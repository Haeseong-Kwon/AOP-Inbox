import path from "node:path";
import { mcpCommand, type PlannedAction, type SetupStep, type StepResult } from "@aop-inbox/core";
import { runArgv } from "../exec";
import type { SnapshotRecord } from "../ledger";
import { executeStepPrompt } from "../prompts/execute-step";
import { runRecipe } from "../recipes";
import { StepError, type ExecutionContext, type Executor } from "./types";

/**
 * Claude Code executor. MCP registration goes through Claude Code's own CLI
 * with argv built from the structured spec (never a parsed string), verified
 * with `claude mcp get` and undone with `claude mcp remove`.
 * A free-form headless mode (claude -p, one step only) exists behind a config
 * flag that is off by default.
 */

function mcpArgv(step: SetupStep, claudeBin: string): string[] {
  const m = step.mcp!;
  const argv = [claudeBin, "mcp", "add"];
  if (m.transport !== "stdio") argv.push("--transport", m.transport);
  argv.push("-s", m.scope, m.name);
  if (m.transport === "stdio") argv.push("--", m.commandOrUrl, ...m.args);
  else argv.push(m.commandOrUrl);
  return argv;
}

const projectFile = (ctx: ExecutionContext) => path.join(ctx.workspace, ".mcp.json");

async function registered(step: SetupStep, ctx: ExecutionContext) {
  return runRecipe("claude-mcp-connected", { name: step.mcp!.name }, ctx);
}

export const claudeCodeExecutor: Executor = {
  id: "claude-code",
  supports: (step, ctx) => (step.type === "mcp_add" && Boolean(step.mcp)) || (ctx.config.headlessClaude && step.type === "command" && step.commands.length > 0),

  async dryRun(step, ctx): Promise<PlannedAction[]> {
    if (step.type !== "mcp_add") {
      return [{ stepId: step.id, type: "command", description: `Claude Code (headless) runs: ${step.commands.join(" && ")}`, reversible: "no" }];
    }
    const m = step.mcp!;
    if (m.envKeys.length) {
      return [{ stepId: step.id, type: "user_action", description: `Add your ${m.envKeys.join(", ")} and register “${m.name}” yourself`, command: mcpCommand(step) ?? undefined, reversible: "yes" }];
    }
    const existing = await registered(step, ctx);
    if (existing.ok) return [{ stepId: step.id, type: "skip", description: `“${m.name}” is already registered`, reversible: "yes" }];
    return [
      {
        stepId: step.id,
        type: "mcp_register",
        description: `Register MCP server “${m.name}” (${m.scope === "project" ? "workspace .mcp.json" : "~/.claude.json"})`,
        command: mcpCommand(step) ?? undefined,
        path: m.scope === "project" ? projectFile(ctx) : path.join(ctx.paths.home, ".claude.json"),
        reversible: "yes",
      },
    ];
  },

  async run(step, ctx): Promise<StepResult> {
    if (step.type !== "mcp_add") return runHeadless(step, ctx);
    const m = step.mcp!;
    if (m.envKeys.length) {
      // Secrets are typed by the person, never handled by the agent.
      return { stepId: step.id, outcome: "needs_user", summary: `Add your ${m.envKeys.join(", ")}: ${mcpCommand(step)}`, changedFiles: [], installed: [], snapshotIds: [], reversible: "yes" };
    }
    const snapshots: string[] = [];
    if (m.scope === "project") snapshots.push(ctx.snapshots.capture(ctx.jobId, step.id, projectFile(ctx)).id);
    const r = await runArgv(mcpArgv(step, ctx.claudeBin), { cwd: ctx.workspace, env: ctx.env, timeoutMs: ctx.timeoutMs, signal: ctx.signal });
    if (r.timedOut) throw new StepError("EXEC_TIMEOUT", "claude mcp add didn't finish in time");
    if (r.code !== 0) throw new StepError("EXEC_COMMAND_FAILED", `claude mcp add failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    const changed = m.scope === "project" ? projectFile(ctx) : path.join(ctx.paths.home, ".claude.json");
    return { stepId: step.id, outcome: "done", summary: `Registered MCP server “${m.name}”`, changedFiles: [{ path: changed, added: 1, removed: 0 }], installed: [], snapshotIds: snapshots, reversible: "yes" };
  },

  async verify(step, ctx) {
    if (step.type !== "mcp_add") return step.verify ? runRecipe(step.verify.recipe, step.verify.args, ctx) : null;
    return registered(step, ctx);
  },

  async rollback(step, snapshots: SnapshotRecord[], ctx) {
    if (step.type !== "mcp_add" || !step.mcp) return "Headless steps can't be undone automatically.";
    const m = step.mcp;
    const r = await runArgv([ctx.claudeBin, "mcp", "remove", m.name, "-s", m.scope], { cwd: ctx.workspace, env: ctx.env, timeoutMs: 60_000 });
    for (const s of snapshots) ctx.snapshots.restore(s);
    if (r.code !== 0 && !/not found/i.test(r.stderr + r.stdout)) throw new StepError("EXEC_COMMAND_FAILED", `claude mcp remove failed: ${r.stderr.slice(0, 200)}`);
    return `Removed MCP server “${m.name}”`;
  },
};

async function runHeadless(step: SetupStep, ctx: ExecutionContext): Promise<StepResult> {
  const prompt = executeStepPrompt(step, { allowedPaths: [ctx.workspace, ...(ctx.config.extraWorkspaces ?? [])], workspace: ctx.workspace });
  const allowed = step.commands.map((c) => `Bash(${c})`);
  const argv = [ctx.claudeBin, "-p", prompt, "--allowedTools", ...allowed, "--disallowedTools", "WebFetch", "WebSearch", "--add-dir", ctx.workspace, "--output-format", "text"];
  const r = await runArgv(argv, { cwd: ctx.workspace, env: ctx.env, timeoutMs: ctx.timeoutMs, signal: ctx.signal });
  if (r.timedOut) throw new StepError("EXEC_TIMEOUT", "Claude Code didn't finish the step in time");
  if (r.code !== 0) throw new StepError("EXEC_COMMAND_FAILED", `Claude Code couldn't complete the step: ${r.stderr.slice(0, 300)}`);
  return { stepId: step.id, outcome: "done", summary: step.title, changedFiles: [], installed: [], snapshotIds: [], reversible: "no", output: r.stdout.slice(-2000) };
}
