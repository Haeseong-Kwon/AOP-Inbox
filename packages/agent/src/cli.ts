import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { hostname, release } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PairRequestSchema } from "@aop-inbox/core";
import { ensureDirs, loadConfig, saveConfig, type AgentConfig } from "./config";
import { runDoctor } from "./doctor";
import { assertSafeServer, GatewayClient } from "./gateway";
import { installLaunchAgent, uninstallLaunchAgent } from "./launchd";
import { Ledger } from "./ledger";
import { agentPaths } from "./paths";
import { JobRunner } from "./runner";
import { keychainStore, tokenAccount } from "./secrets";
import { SnapshotStore } from "./snapshot";
import { AGENT_VERSION, EXECUTOR_VERSION } from "./version";

const HELP = `AOP Inbox Local Agent ${AGENT_VERSION}

Usage: aop-inbox <command>

  init [--server URL] [--code CODE] [--name NAME] [--launchd]   Pair this Mac
  start                       Run the agent (foreground)
  status                      Show connection, pause state and recent jobs
  doctor [--fix]              Check Node, Claude Code, Keychain, network, workspace
  logs [jobId]                Show recent local log lines
  undo <jobId>                Undo a finished setup on this Mac
  pause | resume              Stop / allow execution on this Mac
  service install|uninstall   Run at login as a user LaunchAgent
  uninstall [--purge]         Remove the token and LaunchAgent (--purge also deletes ~/.aop-inbox)
  version
`;

const paths = agentPaths();
const out = (s: string) => process.stdout.write(`${s}\n`);

function requireConfig(): AgentConfig {
  const config = loadConfig(paths);
  if (!config) {
    out("This Mac isn't paired yet. Run `aop-inbox init`.");
    process.exit(1);
  }
  return config;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function init(values: Record<string, string | boolean | undefined>) {
  if (process.platform !== "darwin") {
    out("The AOP Inbox agent currently supports macOS only.");
    process.exit(1);
  }
  ensureDirs(paths);
  const existing = loadConfig(paths);
  const server = String(values.server ?? existing?.server ?? (await ask("AOP Inbox URL (e.g. https://inbox.example.com): ")));
  assertSafeServer(server);
  const code = String(values.code ?? (await ask("Pairing code from Settings → Local Agent: ")));
  const name = String(values.name ?? hostname().replace(/\.local$/, ""));
  const body = PairRequestSchema.parse({ code, name, platform: process.platform, arch: process.arch, agentVersion: AGENT_VERSION });
  const res = await fetch(new URL("/api/agent/pair", server), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { deviceId?: string; token?: string; error?: string };
  if (!res.ok || !data.token) {
    out(data.error ?? `Pairing failed (${res.status}).`);
    process.exit(1);
  }
  await keychainStore.set(tokenAccount(server), data.token);
  saveConfig(paths, { server, deviceId: data.deviceId, deviceName: name, paused: existing?.paused ?? false, autoRunLow: existing?.autoRunLow ?? false, extraWorkspaces: existing?.extraWorkspaces ?? [], headlessClaude: false, snapshotRetentionDays: 30 });
  out(`Paired “${name}”. Token stored in your login Keychain.`);
  out(`Workspace: ${paths.workspace}`);
  if (values.launchd) out(`Runs at login: ${await installLaunchAgent(paths, fileURLToPath(import.meta.url))}`);
  else out("Start it with `aop-inbox start` (or `aop-inbox service install` to run at login).");
}

async function start() {
  const config = requireConfig();
  const token = await keychainStore.get(tokenAccount(config.server));
  if (!token) {
    out("No device token in the Keychain. Run `aop-inbox init`.");
    process.exit(1);
  }
  ensureDirs(paths);
  const ledger = new Ledger(paths.ledgerFile);
  const retention = new SnapshotStore(paths.snapshotsDir, ledger).cleanup(config.snapshotRetentionDays);
  if (retention) out(`Removed ${retention} expired snapshot(s).`);
  let current = config;
  let gateway: GatewayClient | null = null;
  const runner: JobRunner = new JobRunner({ paths, config: () => current, ledger, emit: async (e) => gateway?.emit(e) });
  gateway = new GatewayClient(
    config.server,
    token,
    ledger,
    (m) => runner.handle(m),
    () => ({ paused: runner.paused, activeJobId: runner.activeJobId }),
    () => ({ type: "agent.hello", agentVersion: AGENT_VERSION, executorVersion: EXECUTOR_VERSION, platform: process.platform, arch: process.arch, osVersion: `Darwin ${release()}`, paused: current.paused }),
  );
  // Pick up pause/resume from the CLI without restarting.
  setInterval(() => {
    try {
      current = loadConfig(paths) ?? current;
      void runner.drain();
    } catch {
      // keep last good config
    }
  }, 5000).unref();
  const shutdown = () => {
    gateway?.stop();
    ledger.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  out(`AOP Inbox agent ${AGENT_VERSION} → ${config.server}${current.paused ? " (paused)" : ""}`);
  await gateway.run();
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { server: { type: "string" }, code: { type: "string" }, name: { type: "string" }, launchd: { type: "boolean" }, fix: { type: "boolean" }, purge: { type: "boolean" } },
  });
  const [command, arg] = positionals;
  switch (command) {
    case "init":
      return init(values);
    case "start":
      return start();
    case "status": {
      const config = requireConfig();
      const ledger = new Ledger(paths.ledgerFile);
      out(`Server     ${config.server}\nDevice     ${config.deviceName}\nExecution  ${config.paused ? "paused on this Mac" : "active"}\nAuto-run   ${config.autoRunLow ? "low-risk steps allowed (if also enabled in Settings)" : "off — every setup needs approval"}\nWorkspace  ${paths.workspace}`);
      for (const j of ledger.recentJobs(10)) out(`  ${j.updatedAt.slice(0, 16).replace("T", " ")}  ${j.status.padEnd(12)} ${j.jobId}`);
      return;
    }
    case "doctor": {
      if (values.fix) {
        ensureDirs(paths);
        try {
          chmodSync(paths.configFile, 0o600);
        } catch {
          // no config yet
        }
      }
      const checks = await runDoctor(paths, keychainStore);
      for (const c of checks) out(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(28)} ${c.detail}${!c.ok && c.fix ? `\n    → ${c.fix.kind === "auto" ? "fixable with `aop-inbox doctor --fix`: " : ""}${c.fix.hint}` : ""}`);
      process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
      return;
    }
    case "logs": {
      mkdirSync(paths.stateDir, { recursive: true });
      const ledger = new Ledger(paths.ledgerFile);
      for (const l of ledger.logs(arg).reverse()) out(`${l.createdAt} ${l.level.padEnd(5)} ${l.jobId ?? "-"} ${l.message}`);
      return;
    }
    case "undo": {
      if (!arg) return out("Usage: aop-inbox undo <jobId>");
      const config = requireConfig();
      const ledger = new Ledger(paths.ledgerFile);
      const token = await keychainStore.get(tokenAccount(config.server));
      const gateway = token ? new GatewayClient(config.server, token, ledger, async () => {}, () => ({ paused: false, activeJobId: null }), () => ({ type: "agent.heartbeat", paused: false, activeJobId: null })) : null;
      const runner = new JobRunner({ paths, config: () => config, ledger, emit: async (e) => (gateway ? gateway.emit(e) : void ledger.enqueueEvent(e)) });
      const result = await runner.undo(arg);
      return out(result.ok ? `Undone. ${result.detail}` : `Couldn't fully undo: ${result.detail}`);
    }
    case "pause":
    case "resume": {
      const config = requireConfig();
      saveConfig(paths, { ...config, paused: command === "pause" });
      return out(command === "pause" ? "Execution paused on this Mac. Jobs wait until you run `aop-inbox resume`." : "Execution resumed.");
    }
    case "service": {
      if (arg === "install") return out(`Installed ${await installLaunchAgent(paths, fileURLToPath(import.meta.url))}`);
      if (arg === "uninstall") return out((await uninstallLaunchAgent(paths)) ? "LaunchAgent removed." : "No LaunchAgent installed.");
      return out("Usage: aop-inbox service install|uninstall");
    }
    case "uninstall": {
      const config = loadConfig(paths);
      if (config) await keychainStore.delete(tokenAccount(config.server));
      await uninstallLaunchAgent(paths);
      if (values.purge) rmSync(paths.stateDir, { recursive: true, force: true });
      out(`Removed the device token${values.purge ? " and ~/.aop-inbox" : ""}. Your workspace (${paths.workspace}) was left in place. Revoke the device in Settings too.`);
      return;
    }
    case "version":
      return out(AGENT_VERSION);
    default:
      out(HELP);
  }
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
