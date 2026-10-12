import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { referencesSensitivePath } from "./command";

/**
 * Where a step may write. Never `startsWith`: paths are expanded, resolved and
 * (on the device) realpath'd through the nearest existing ancestor, so `..`
 * traversal and symlinks that point outside an allowed root are caught.
 */

export type PathZone = "workspace" | "claude_config" | "shell_profile" | "agent_state" | "sensitive" | "outside";

export interface PathContext {
  home: string;
  workspace: string;
  stateDir: string;
  /** additional workspaces the user approved */
  extraWorkspaces?: string[];
  /** "real" resolves symlinks on disk (device); "lexical" only normalizes (server preview). */
  mode: "real" | "lexical";
}

const SHELL_PROFILES = [".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile", ".config/fish/config.fish"];

export const ZONE_RISK: Record<PathZone, "low" | "medium" | "high"> = {
  workspace: "low",
  claude_config: "medium",
  shell_profile: "medium",
  agent_state: "high",
  sensitive: "high",
  outside: "high",
};

export function expandHome(p: string, home: string): string {
  if (p === "~" || p === "$HOME" || p === "${HOME}") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  if (p.startsWith("$HOME/")) return path.join(home, p.slice(6));
  if (p.startsWith("${HOME}/")) return path.join(home, p.slice(8));
  return p;
}

/** realpath of the deepest existing ancestor + the not-yet-existing remainder. */
function realResolve(abs: string): string {
  let current = abs;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    // unreadable ancestor — keep lexical form
  }
  return path.join(real, ...rest);
}

export function resolvePath(p: string, ctx: PathContext, cwd = ctx.workspace): string {
  const expanded = expandHome(p.trim(), ctx.home);
  const abs = path.resolve(cwd, expanded);
  return ctx.mode === "real" ? realResolve(abs) : path.normalize(abs);
}

export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function classifyPath(p: string, ctx: PathContext, cwd?: string): { zone: PathZone; resolved: string } {
  const resolved = resolvePath(p, ctx, cwd);
  const root = (r: string) => resolvePath(r, ctx, "/");
  const home = root(ctx.home);
  if (referencesSensitivePath(resolved) || referencesSensitivePath(p)) return { zone: "sensitive", resolved };
  if (isWithin(resolved, root(ctx.stateDir))) return { zone: "agent_state", resolved };
  for (const ws of [ctx.workspace, ...(ctx.extraWorkspaces ?? [])]) {
    if (isWithin(resolved, root(ws))) return { zone: "workspace", resolved };
  }
  if (isWithin(resolved, path.join(home, ".claude")) || resolved === path.join(home, ".claude.json")) {
    return { zone: "claude_config", resolved };
  }
  if (SHELL_PROFILES.some((f) => resolved === path.join(home, f))) return { zone: "shell_profile", resolved };
  return { zone: "outside", resolved };
}

/** Server-side preview context: no access to the device, so paths are classified lexically. */
export const PREVIEW_PATHS: PathContext = {
  home: "/Users/you",
  workspace: "/Users/you/aop-inbox-workspace",
  stateDir: "/Users/you/.aop-inbox",
  mode: "lexical",
};

/**
 * Runtime guard, run on the device immediately before executing argv: every
 * argument that names an existing file is resolved through symlinks. Static
 * analysis can't see a symlink planted by an earlier step (e.g. a cloned repo
 * containing `x -> ~`), this can.
 */
export function checkRuntimePaths(
  argv: string[],
  cwd: string,
  ctx: PathContext,
  opts: { readOnly: boolean },
): { ok: true } | { ok: false; reason: string } {
  const candidates = argv.slice(1).flatMap((a) => {
    if (a.startsWith("-")) return a.includes("=") ? [a.slice(a.indexOf("=") + 1)] : [];
    return [a];
  });
  for (const arg of candidates) {
    if (!arg || /^[a-z][a-z0-9+.-]*:/i.test(arg)) continue; // URLs, registry specs like npm:x
    const abs = path.resolve(cwd, expandHome(arg, ctx.home));
    if (!existsSync(abs) && !arg.includes("/")) continue; // a plain word, not a path
    const { zone, resolved } = classifyPath(arg, { ...ctx, mode: "real" }, cwd);
    if (zone === "sensitive") return { ok: false, reason: `Refused: ${arg} resolves to a protected location` };
    if (zone === "agent_state") return { ok: false, reason: `Refused: ${arg} points into AOP Inbox's own state` };
    if (opts.readOnly && zone !== "workspace") return { ok: false, reason: `Refused: ${arg} resolves outside the workspace (${resolved})` };
  }
  return { ok: true };
}
