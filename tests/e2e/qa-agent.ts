/**
 * Dev/QA helper (not part of the suite): pairs a SANDBOXED agent with the running
 * dev server over the real HTTP/SSE transport and keeps it connected.
 *   pnpm tsx tests/e2e/qa-agent.ts [seconds]
 * HOME is a temp dir, the token stays in memory (never the real Keychain) and
 * `claude` is a fake that records MCP registrations in a JSON file.
 */
import { readFileSync } from "node:fs";
import { release } from "node:os";
import { GatewayClient } from "../../packages/agent/src/gateway";
import { AGENT_VERSION, EXECUTOR_VERSION } from "../../packages/agent/src/version";
import { sandbox } from "../../packages/agent/test/helpers";
import { JobRunner } from "../../packages/agent/src/runner";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const seconds = Number(process.argv[2] ?? 120);
const state = JSON.parse(readFileSync("tests/e2e/.auth/user.json", "utf8")) as { cookies: { name: string; value: string }[] };
const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

const pair = await fetch(`${base}/api/devices/pair`, { method: "POST", headers: { cookie, origin: base } });
const { code } = (await pair.json()) as { code: string };
const res = await fetch(`${base}/api/agent/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, name: "QA MacBook", platform: "darwin", arch: process.arch, agentVersion: AGENT_VERSION }),
});
const { token } = (await res.json()) as { token: string };
const box = sandbox();
let gateway: GatewayClient | null = null;
const runner: JobRunner = new JobRunner({ paths: box.paths, config: () => ({ server: base, deviceName: "QA MacBook", paused: false, autoRunLow: false, extraWorkspaces: [], headlessClaude: false, snapshotRetentionDays: 30 }), ledger: box.ledger, emit: async (e) => gateway?.emit(e), claudeBin: box.claudeBin });
gateway = new GatewayClient(base, token, box.ledger, (m) => runner.handle(m), () => ({ paused: runner.paused, activeJobId: runner.activeJobId }), () => ({ type: "agent.hello", agentVersion: AGENT_VERSION, executorVersion: EXECUTOR_VERSION, platform: "darwin", arch: process.arch, osVersion: `Darwin ${release()}`, paused: false }));
console.log(`QA agent connected (home ${box.home}) for ${seconds}s`);
setTimeout(() => {
  gateway?.stop();
  process.exit(0);
}, seconds * 1000);
await gateway.run();
