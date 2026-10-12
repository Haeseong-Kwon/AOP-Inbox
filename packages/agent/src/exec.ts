import { spawn, type ChildProcess } from "node:child_process";
import { redactSecrets } from "@aop-inbox/core";

/**
 * Runs one argv — never through a shell. Child gets a minimal environment (no
 * tokens or keys inherited), its own process group, and is killed with that
 * whole group on timeout so nothing lingers.
 */

export const STEP_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024;

export type ChildEnv = Record<string, string | undefined>;

export function sanitizedEnv(home: string, extra: Record<string, string> = {}): ChildEnv {
  const path = [process.env.PATH ?? "", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", `${home}/.local/bin`].filter(Boolean).join(":");
  return {
    PATH: path,
    HOME: home,
    USER: process.env.USER,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1", // keeps installers non-interactive
    npm_config_fund: "false",
    npm_config_audit: "false",
    ...extra,
  };
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runArgv(argv: string[], opts: { cwd: string; env: ChildEnv; timeoutMs?: number; signal?: AbortSignal }): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: 127, stdout: "", stderr: String(error), timedOut: false });
      return;
    }
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already exited
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs ?? STEP_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", kill);
    child.stdout?.on("data", (d: Buffer) => (stdout = (stdout + d.toString()).slice(-MAX_OUTPUT)));
    child.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-MAX_OUTPUT)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(error), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      kill(); // reap any grandchildren left in the group
      resolve({ code, stdout: redactSecrets(stdout), stderr: redactSecrets(stderr), timedOut });
    });
  });
}
