import { homedir } from "node:os";
import path from "node:path";
import type { PathContext } from "@aop-inbox/core";

/**
 * Agent locations. AOP_INBOX_HOME overrides the home directory (tests and
 * sandboxes) so nothing ever touches the real ~/.claude or ~/.aop-inbox.
 */
export interface AgentPaths {
  home: string;
  stateDir: string;
  configFile: string;
  ledgerFile: string;
  logsDir: string;
  snapshotsDir: string;
  workspace: string;
}

export function agentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
  const home = env.AOP_INBOX_HOME ?? homedir();
  const stateDir = path.join(home, ".aop-inbox");
  return {
    home,
    stateDir,
    configFile: path.join(stateDir, "config.json"),
    ledgerFile: path.join(stateDir, "ledger.db"),
    logsDir: path.join(stateDir, "logs"),
    snapshotsDir: path.join(stateDir, "snapshots"),
    workspace: path.join(home, "aop-inbox-workspace"),
  };
}

export function pathContext(p: AgentPaths, extraWorkspaces: string[] = []): PathContext {
  return { home: p.home, workspace: p.workspace, stateDir: p.stateDir, extraWorkspaces, mode: "real" };
}
