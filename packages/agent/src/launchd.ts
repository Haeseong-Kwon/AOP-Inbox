import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentPaths } from "./paths";

const run = promisify(execFile);
export const LABEL = "com.aopinbox.agent";

/** User-level LaunchAgent only — never a system daemon, never root. */
export function plistPath(p: AgentPaths): string {
  return path.join(p.home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function installLaunchAgent(p: AgentPaths, cliPath: string): Promise<string> {
  const file = plistPath(p);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(cliPath)}</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(path.join(p.logsDir, "agent.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(p.logsDir, "agent.err.log"))}</string>
</dict>
</plist>
`,
    { mode: 0o644 },
  );
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await run("/bin/launchctl", ["bootout", domain, file]).catch(() => {});
  await run("/bin/launchctl", ["bootstrap", domain, file]);
  return file;
}

export async function uninstallLaunchAgent(p: AgentPaths): Promise<boolean> {
  const file = plistPath(p);
  if (!existsSync(file)) return false;
  await run("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}`, file]).catch(() => {});
  rmSync(file, { force: true });
  return true;
}
