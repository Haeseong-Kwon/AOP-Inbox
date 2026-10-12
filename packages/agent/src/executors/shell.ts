import { existsSync, readFileSync, statSync } from "node:fs";
import {
  analyzeCommand,
  checkPackageManagerConfig,
  checkRuntimePaths,
  classifyPath,
  commandName,
  FILE_READERS,
  toArgvList,
  type PlannedAction,
  type SetupStep,
  type StepResult,
} from "@aop-inbox/core";
import { runArgv } from "../exec";
import type { SnapshotRecord } from "../ledger";
import { runRecipe } from "../recipes";
import { StepError, type ExecutionContext, type Executor } from "./types";

const lineCount = (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8").split("\n").length : 0);

/** cli_install / command steps: argv only, after runtime path and package-manager checks. */
export const shellExecutor: Executor = {
  id: "shell",
  supports: (step) => (step.type === "cli_install" || step.type === "command") && step.commands.length > 0 && !step.needsUser,

  async dryRun(step, ctx) {
    const actions: PlannedAction[] = [];
    for (const command of step.commands) {
      const a = analyzeCommand(command);
      if (!a.executable) throw new StepError("POLICY_DENIED", `“${command}” can't be run automatically: ${a.reasons[0] ?? "needs a shell"}`);
      for (const w of a.writes) {
        const { zone, resolved } = classifyPath(w, ctx.paths, ctx.workspace);
        if (zone !== "workspace") throw new StepError("POLICY_DENIED", `“${command}” writes outside the workspace (${w})`);
        actions.push({ stepId: step.id, type: existsSync(resolved) ? "file_update" : "file_create", description: `${existsSync(resolved) ? "Updates" : "Creates"} ${w}`, path: resolved, reversible: "yes" });
      }
      actions.push({ stepId: step.id, type: a.kind === "package_install" ? "package_install" : "command", description: step.title, command, reversible: a.kind === "package_install" ? "partial" : a.kind === "read_only" ? "yes" : a.writes.length ? "yes" : "no" });
    }
    return actions;
  },

  async run(step, ctx) {
    const snapshotIds: string[] = [];
    const created: string[] = [];
    const installed = new Set<string>();
    let output = "";
    for (const command of step.commands) {
      const a = analyzeCommand(command);
      if (!a.executable) throw new StepError("POLICY_DENIED", `“${command}” can't be run automatically`);
      // Snapshot every file the command will write (only workspace targets are allowed at all).
      for (const w of a.writes) {
        const { zone, resolved } = classifyPath(w, ctx.paths, ctx.workspace);
        if (zone !== "workspace") throw new StepError("POLICY_DENIED", `Writes outside the workspace (${w})`);
        if (!existsSync(resolved) || statSync(resolved).isFile()) {
          snapshotIds.push(ctx.snapshots.capture(ctx.jobId, step.id, resolved).id);
          created.push(resolved);
        }
      }
      for (const argv of toArgvList(command, ctx.paths.home)) {
        const guard = checkRuntimePaths(argv, ctx.workspace, ctx.paths, { readOnly: FILE_READERS.has(commandName(argv)) });
        if (!guard.ok) throw new StepError("POLICY_DENIED", guard.reason);
        const pm = checkPackageManagerConfig(argv, ctx.workspace);
        if (!pm.ok) throw new StepError("POLICY_DENIED", pm.reason);
        const r = await runArgv(argv, { cwd: ctx.workspace, env: ctx.env, timeoutMs: ctx.timeoutMs, signal: ctx.signal });
        if (r.timedOut) throw new StepError("EXEC_TIMEOUT", `“${argv.join(" ")}” didn't finish within ${Math.round(ctx.timeoutMs / 60000)} minutes`);
        if (r.code !== 0) throw new StepError("EXEC_COMMAND_FAILED", `“${argv.join(" ")}” exited with ${r.code}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300)}`);
        output += r.stdout.slice(-1000);
      }
      a.installs.forEach((p) => installed.add(p));
    }
    return {
      stepId: step.id,
      outcome: "done",
      summary: installed.size ? `Installed ${[...installed].join(", ")}` : step.title,
      changedFiles: created.filter(existsSync).map((p) => ({ path: p, added: lineCount(p), removed: 0 })),
      installed: [...installed],
      snapshotIds,
      reversible: installed.size ? "partial" : snapshotIds.length ? "yes" : "no",
      output: output.slice(-2000),
    } satisfies StepResult;
  },

  async verify(step, ctx) {
    return step.verify ? runRecipe(step.verify.recipe, step.verify.args, ctx) : null;
  },

  async rollback(step: SetupStep, snapshots: SnapshotRecord[], ctx: ExecutionContext) {
    for (const s of snapshots) ctx.snapshots.restore(s);
    const installs = step.commands.flatMap((c) => analyzeCommand(c).installs);
    return installs.length
      ? `Restored files. ${installs.join(", ")} ${installs.length === 1 ? "was" : "were"} not uninstalled automatically.`
      : `Restored ${snapshots.length} file${snapshots.length === 1 ? "" : "s"}.`;
  },
};
