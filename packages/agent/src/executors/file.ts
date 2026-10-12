import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyPath, type Change, type PlannedAction, type SetupStep, type StepResult, type VerifyResult } from "@aop-inbox/core";
import type { SnapshotRecord } from "../ledger";
import { StepError, type ExecutionContext, type Executor } from "./types";

/** config_write / file_create from a structured `change` only. */

const WRITABLE_ZONES = new Set(["workspace", "claude_config", "shell_profile"]);
const MAX_FILE = 2_000_000;

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k] as JsonObject, v) : v;
  }
  return out;
}

export function applyChange(change: Change, current: string | null): string {
  if (change.kind === "file_write") return change.content;
  if (change.kind === "append_line") {
    const text = current ?? "";
    if (text.split("\n").includes(change.line)) return text;
    return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${change.line}\n`;
  }
  let base: unknown = {};
  if (current && current.trim()) {
    try {
      base = JSON.parse(current);
    } catch {
      throw new StepError("EXEC_COMMAND_FAILED", "The existing file isn't valid JSON, so it wasn't changed");
    }
  }
  if (!isObject(base)) throw new StepError("EXEC_COMMAND_FAILED", "The existing JSON isn't an object, so it wasn't changed");
  return JSON.stringify(deepMerge(base, change.value), null, 2) + "\n";
}

/** Small line diff for the review screen (not a full LCS — enough to see what changes). */
export function diffPreview(before: string | null, after: string): string {
  const a = (before ?? "").split("\n");
  const b = after.split("\n");
  const aSet = new Set(a);
  const bSet = new Set(b);
  const lines = [...a.filter((l) => !bSet.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !aSet.has(l)).map((l) => `+ ${l}`)];
  return lines.filter((l) => l.trim() !== "-" && l.trim() !== "+").join("\n").slice(0, 8000);
}

function target(step: SetupStep, ctx: ExecutionContext): { change: Change; file: string } {
  const change = step.change;
  if (!change) throw new StepError("SPEC_INVALID", "No structured change in this step");
  const { zone, resolved } = classifyPath(change.path, ctx.paths, ctx.workspace);
  if (!WRITABLE_ZONES.has(zone)) throw new StepError("POLICY_DENIED", `${change.path} is outside the folders AOP Inbox may change`);
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new StepError("POLICY_DENIED", `${change.path} is a symlink; not following it`);
  return { change, file: resolved };
}

function read(file: string): string | null {
  if (!existsSync(file)) return null;
  const data = readFileSync(file);
  if (data.length > MAX_FILE) throw new StepError("EXEC_COMMAND_FAILED", "File too large to change safely");
  return data.toString("utf8");
}

const count = (s: string | null) => (s ? s.split("\n").filter(Boolean).length : 0);

export const fileExecutor: Executor = {
  id: "file",
  supports: (step) => (step.type === "config_write" || step.type === "file_create") && Boolean(step.change) && !step.needsUser,

  async dryRun(step, ctx) {
    const { change, file } = target(step, ctx);
    const current = read(file);
    const next = applyChange(change, current);
    const action: PlannedAction =
      current === next
        ? { stepId: step.id, type: "skip", description: `${change.path} is already configured`, path: file, reversible: "yes" }
        : { stepId: step.id, type: current === null ? "file_create" : "file_update", description: step.title, path: file, diffPreview: diffPreview(current, next), reversible: "yes" };
    return [action];
  },

  async run(step, ctx) {
    const { change, file } = target(step, ctx);
    const current = read(file);
    const next = applyChange(change, current);
    if (current === next) {
      return { stepId: step.id, outcome: "skipped", summary: "Already configured", changedFiles: [], installed: [], snapshotIds: [], reversible: "yes" } satisfies StepResult;
    }
    const snap = ctx.snapshots.capture(ctx.jobId, step.id, file);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.aop-${process.pid}.tmp`;
    writeFileSync(tmp, next, { mode: 0o644 });
    if (snap.kind === "file" && typeof snap.meta.mode === "number") chmodSync(tmp, snap.meta.mode);
    renameSync(tmp, file);
    const added = Math.max(0, count(next) - count(current));
    const diff = diffPreview(current, next);
    return {
      stepId: step.id,
      outcome: "done",
      summary: `${current === null ? "Created" : "Updated"} ${change.path}`,
      changedFiles: [{ path: file, added: diff.split("\n").filter((l) => l.startsWith("+ ")).length || added, removed: diff.split("\n").filter((l) => l.startsWith("- ")).length }],
      installed: [],
      snapshotIds: [snap.id],
      reversible: "yes",
    } satisfies StepResult;
  },

  async verify(step, ctx): Promise<VerifyResult | null> {
    const { change, file } = target(step, ctx);
    const current = read(file);
    const wanted = applyChange(change, current);
    const ok = current !== null && current === wanted;
    return { recipe: `file-${change.kind}`, ok, detail: ok ? `${change.path} has the expected content` : `${change.path} doesn't have the expected content` };
  },

  async rollback(_step, snapshots: SnapshotRecord[], ctx) {
    for (const s of snapshots) ctx.snapshots.restore(s);
    return `Restored ${snapshots.map((s) => path.basename(s.originalPath)).join(", ")}`;
  },
};
