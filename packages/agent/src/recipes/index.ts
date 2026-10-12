import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { classifyPath, RECIPE_CATALOG, validateRecipeArgs, type RecipeId, type VerifyResult } from "@aop-inbox/core";
import { runArgv } from "../exec";
import type { ExecutionContext } from "../executors/types";

/**
 * Verification recipes: fixed, read-only probes. A recipe never runs a string
 * from the content — only the argv lists written here.
 */

type Args = Record<string, string>;
export interface VerifyRecipe {
  id: RecipeId;
  version: number;
  description: string;
  risk: "read-only";
  run(args: Args, ctx: ExecutionContext): Promise<VerifyResult>;
}

const PROBE_TIMEOUT = 20_000;
const ok = (recipe: string, detail: string, observed?: string): VerifyResult => ({ recipe, ok: true, detail, observed });
const fail = (recipe: string, detail: string, observed?: string): VerifyResult => ({ recipe, ok: false, detail, observed });

async function probe(argv: string[], ctx: ExecutionContext) {
  return runArgv(argv, { cwd: ctx.workspace, env: ctx.env, timeoutMs: PROBE_TIMEOUT, signal: ctx.signal });
}

function versionAtLeast(actual: string, min: string): boolean {
  const a = actual.replace(/^v/, "").split(".").map(Number);
  const m = min.split(".").map(Number);
  for (let i = 0; i < m.length; i++) {
    if ((a[i] ?? 0) !== m[i]) return (a[i] ?? 0) > m[i];
  }
  return true;
}

/** Files a recipe may read: anywhere a step may write, never sensitive locations. */
function readable(p: string, ctx: ExecutionContext): string | null {
  const { zone, resolved } = classifyPath(p, ctx.paths, ctx.workspace);
  return zone === "sensitive" || zone === "outside" || zone === "agent_state" ? null : resolved;
}

function getKey(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

const impl: Record<RecipeId, (args: Args, ctx: ExecutionContext) => Promise<VerifyResult>> = {
  "node-installed": async (args, ctx) => {
    const r = await probe(["node", "--version"], ctx);
    const version = r.stdout.trim();
    if (r.code !== 0 || !version) return fail("node-installed", "Node.js isn't installed");
    if (args.minVersion && !versionAtLeast(version, args.minVersion)) return fail("node-installed", `Node.js ${version} is older than ${args.minVersion}`, version);
    return ok("node-installed", `Node.js ${version} is installed`, version);
  },
  "command-exists": async (args, ctx) => {
    for (const dir of (ctx.env.PATH ?? "").split(":")) {
      const candidate = path.join(dir, args.command);
      if (dir && existsSync(candidate)) return ok("command-exists", `${args.command} is available`, candidate);
    }
    return fail("command-exists", `${args.command} isn't on PATH`);
  },
  "package-installed": async (args, ctx) => {
    const { manager, name } = args;
    if (manager === "npm") {
      const pkg = path.join(ctx.workspace, "node_modules", name, "package.json");
      if (!existsSync(pkg)) return fail("package-installed", `${name} isn't installed in the workspace`);
      return ok("package-installed", `${name} is installed in the workspace`, JSON.parse(readFileSync(pkg, "utf8")).version);
    }
    const argv =
      manager === "npm-global" ? ["npm", "ls", "-g", "--depth=0", "--json", name] : manager === "brew" ? ["brew", "list", "--versions", name] : ["pip3", "show", name];
    const r = await probe(argv, ctx);
    if (r.code !== 0) return fail("package-installed", `${name} isn't installed (${manager})`);
    if (manager === "npm-global") {
      const version = (JSON.parse(r.stdout || "{}").dependencies?.[name]?.version as string | undefined) ?? undefined;
      return version ? ok("package-installed", `${name}@${version} is installed globally`, version) : fail("package-installed", `${name} isn't installed globally`);
    }
    return ok("package-installed", `${name} is installed (${manager})`, r.stdout.trim().split(/\s+/).pop());
  },
  "file-contains": async (args, ctx) => {
    const p = readable(args.path, ctx);
    if (!p) return fail("file-contains", `Not allowed to read ${args.path}`);
    if (!existsSync(p) || statSync(p).size > 2_000_000) return fail("file-contains", `${args.path} doesn't exist`);
    return readFileSync(p, "utf8").includes(args.text) ? ok("file-contains", `${args.path} contains the expected text`) : fail("file-contains", `${args.path} doesn't contain the expected text`);
  },
  "json-key-equals": async (args, ctx) => {
    const p = readable(args.path, ctx);
    if (!p) return fail("json-key-equals", `Not allowed to read ${args.path}`);
    if (!existsSync(p)) return fail("json-key-equals", `${args.path} doesn't exist`);
    let value: unknown;
    try {
      value = getKey(JSON.parse(readFileSync(p, "utf8")), args.key);
    } catch {
      return fail("json-key-equals", `${args.path} isn't valid JSON`);
    }
    if (value === undefined) return fail("json-key-equals", `${args.key} is missing in ${args.path}`);
    if (args.value !== undefined && String(typeof value === "object" ? JSON.stringify(value) : value) !== args.value) {
      return fail("json-key-equals", `${args.key} has a different value`, String(value).slice(0, 80));
    }
    return ok("json-key-equals", `${args.key} is set in ${args.path}`);
  },
  "directory-exists": async (args, ctx) => {
    const p = readable(args.path, ctx);
    if (!p) return fail("directory-exists", `Not allowed to check ${args.path}`);
    return existsSync(p) && statSync(p).isDirectory() ? ok("directory-exists", `${args.path} exists`) : fail("directory-exists", `${args.path} doesn't exist`);
  },
  "claude-mcp-connected": async (args, ctx) => {
    const r = await probe([ctx.claudeBin, "mcp", "get", args.name], ctx);
    if (r.code !== 0 || /not found|no mcp server/i.test(r.stdout + r.stderr)) return fail("claude-mcp-connected", `Claude Code doesn't list “${args.name}”`);
    const connected = /connected|✓/i.test(r.stdout);
    return connected ? ok("claude-mcp-connected", `“${args.name}” is registered and connected`) : ok("claude-mcp-connected", `“${args.name}” is registered (it connects when Claude Code starts)`);
  },
  "http-healthcheck": async (args) => {
    try {
      const res = await fetch(args.url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      return res.status < 500 ? ok("http-healthcheck", `${args.url} answered ${res.status}`) : fail("http-healthcheck", `${args.url} answered ${res.status}`);
    } catch {
      return fail("http-healthcheck", `${args.url} isn't answering`);
    }
  },
};

export const RECIPES: Record<RecipeId, VerifyRecipe> = Object.fromEntries(
  Object.entries(RECIPE_CATALOG).map(([id, meta]) => [id, { id: id as RecipeId, version: meta.version, description: meta.description, risk: "read-only", run: impl[id as RecipeId] }]),
) as Record<RecipeId, VerifyRecipe>;

export async function runRecipe(recipe: string, args: Args, ctx: ExecutionContext): Promise<VerifyResult> {
  const valid = validateRecipeArgs(recipe, args);
  if (!valid.ok) return fail(recipe, valid.error);
  return RECIPES[recipe as RecipeId].run(args, ctx);
}
