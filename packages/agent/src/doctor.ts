import { accessSync, constants, existsSync, statSync } from "node:fs";
import { loadConfig } from "./config";
import { runArgv, sanitizedEnv } from "./exec";
import { assertSafeServer } from "./gateway";
import type { AgentPaths } from "./paths";
import { tokenAccount, type TokenStore } from "./secrets";
import { AGENT_VERSION } from "./version";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** "auto": `aop-inbox doctor --fix` can repair it. "manual": the person has to. */
  fix?: { kind: "auto" | "manual"; hint: string };
}

const MIN_NODE = [22, 13];

export async function runDoctor(p: AgentPaths, tokens: TokenStore, opts: { claudeBin?: string } = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  checks.push({
    name: "Node.js",
    ok: major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]),
    detail: `v${process.versions.node}`,
    fix: { kind: "manual", hint: "Install Node 22.13+ (e.g. `mise use -g node@24`)." },
  });

  const env = sanitizedEnv(p.home);
  const claude = await runArgv([opts.claudeBin ?? "claude", "--version"], { cwd: p.home, env, timeoutMs: 15_000 });
  checks.push({ name: "Claude Code", ok: claude.code === 0, detail: claude.code === 0 ? claude.stdout.trim() : "not found on PATH", fix: { kind: "manual", hint: "Install Claude Code: https://docs.anthropic.com/claude-code" } });
  if (claude.code === 0) {
    const mcp = await runArgv([opts.claudeBin ?? "claude", "mcp", "list"], { cwd: p.workspace, env, timeoutMs: 30_000 });
    checks.push({ name: "Claude Code authentication", ok: mcp.code === 0, detail: mcp.code === 0 ? "Claude Code responds" : "Claude Code didn't respond — sign in by running `claude` once", fix: { kind: "manual", hint: "Run `claude` and complete sign-in." } });
  }

  let config = null;
  try {
    config = loadConfig(p);
    checks.push({ name: "Config", ok: Boolean(config), detail: config ? "valid" : "missing — run `aop-inbox init`", fix: { kind: "manual", hint: "Run `aop-inbox init`." } });
  } catch (error) {
    checks.push({ name: "Config", ok: false, detail: (error as Error).message, fix: { kind: "manual", hint: "Delete ~/.aop-inbox/config.json and run `aop-inbox init`." } });
  }
  if (existsSync(p.configFile)) {
    const mode = statSync(p.configFile).mode & 0o777;
    checks.push({ name: "Config permissions", ok: (mode & 0o077) === 0, detail: mode.toString(8), fix: { kind: "auto", hint: "chmod 600 ~/.aop-inbox/config.json" } });
  }

  let workspaceOk = false;
  try {
    accessSync(p.workspace, constants.W_OK);
    workspaceOk = true;
  } catch {
    // reported below
  }
  checks.push({ name: "Workspace", ok: workspaceOk, detail: p.workspace, fix: { kind: "auto", hint: "Create the workspace folder." } });

  if (config) {
    const token = await tokens.get(tokenAccount(config.server));
    checks.push({ name: "Keychain token", ok: Boolean(token), detail: token ? "present" : "missing", fix: { kind: "manual", hint: "Run `aop-inbox init` to pair again." } });
    try {
      assertSafeServer(config.server);
      const res = await fetch(new URL("/login", config.server), { signal: AbortSignal.timeout(8000), redirect: "manual" });
      checks.push({ name: "Gateway", ok: res.status < 500, detail: `${config.server} (${res.status})` });
    } catch (error) {
      checks.push({ name: "Gateway", ok: false, detail: `${config.server}: ${(error as Error).message}`, fix: { kind: "manual", hint: "Check your network or the server URL." } });
    }
  }
  checks.push({ name: "Agent version", ok: true, detail: AGENT_VERSION });
  return checks;
}
