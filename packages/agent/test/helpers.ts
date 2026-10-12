import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentEvent, Dispatch, SetupSpec, SetupStep } from "@aop-inbox/core";
import { ensureDirs, type AgentConfig } from "../src/config";
import { Ledger } from "../src/ledger";
import { agentPaths } from "../src/paths";
import { JobRunner } from "../src/runner";

/** A throwaway HOME with workspace, ledger and a fake `claude` CLI that records MCP servers in a JSON file. */
export function sandbox() {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "aop-agent-")));
  const paths = agentPaths({ AOP_INBOX_HOME: home });
  ensureDirs(paths);
  const bin = path.join(home, "bin");
  mkdirSync(bin);
  const claudeBin = path.join(bin, "claude");
  const db = path.join(home, "fake-claude-mcp.json");
  writeFileSync(
    claudeBin,
    `#!/bin/sh
DB="${db}"
[ -f "$DB" ] || echo '{}' > "$DB"
if [ "$1" = "mcp" ] && [ "$2" = "add" ]; then
  shift 2; while [ "$1" = "-s" ] || [ "$1" = "--transport" ]; do shift 2; done
  name="$1"; node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d[process.argv[2]]=true;fs.writeFileSync(process.argv[1],JSON.stringify(d))' "$DB" "$name"; exit 0
fi
if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(d[process.argv[2]]?0:1)' "$DB" "$3" && echo "$3: ✓ Connected" || { echo "No MCP server found with name: $3"; exit 1; }; exit $?
fi
if [ "$1" = "mcp" ] && [ "$2" = "remove" ]; then
  node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));delete d[process.argv[2]];fs.writeFileSync(process.argv[1],JSON.stringify(d))' "$DB" "$3"; exit 0
fi
echo "fake claude"; exit 0
`,
  );
  chmodSync(claudeBin, 0o755);
  const config: AgentConfig = { server: "http://localhost:3000", deviceName: "test", paused: false, autoRunLow: false, extraWorkspaces: [], headlessClaude: false, snapshotRetentionDays: 30 };
  const ledger = new Ledger(paths.ledgerFile);
  const events: AgentEvent[] = [];
  let current = config;
  const runner = new JobRunner({ paths, config: () => current, ledger, emit: async (e) => void events.push(e), claudeBin, timeoutMs: 30_000 });
  return {
    home,
    paths,
    ledger,
    events,
    runner,
    claudeBin,
    setConfig: (patch: Partial<AgentConfig>) => (current = { ...current, ...patch }),
    types: () => events.map((e) => e.type),
  };
}

export function step(overrides: Partial<SetupStep> & Pick<SetupStep, "id">): SetupStep {
  return { title: overrides.id, type: "command", instruction: "do it", commands: [], needsUser: false, risk: "low", confidence: 0.95, evidence: { quote: "from the source" }, dependsOn: [], ...overrides };
}

export function spec(steps: SetupStep[], extra: Partial<SetupSpec> = {}): SetupSpec {
  return { specVersion: 1, source: { itemId: "item", platform: "web" }, contentType: "executable", summary: "test", steps, suspiciousInstructions: [], ...extra };
}

let n = 0;
export function dispatch(s: SetupSpec, mode: "dry_run" | "execute", approvedStepIds: string[] = [], completedStepIds: string[] = []): Dispatch {
  n++;
  return { type: "job.dispatch", jobId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, mode, specRevision: 1, spec: s, approvedStepIds, completedStepIds };
}
