import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { AgentPaths } from "./paths";

/** Local config. Never contains credentials — the device token lives in the Keychain. */
export const ConfigSchema = z.object({
  server: z.url(),
  deviceId: z.string().optional(),
  deviceName: z.string().max(80),
  /** Local kill switch (aop-inbox pause). Independent of the dashboard switch; either one stops execution. */
  paused: z.boolean().default(false),
  /** Local consent for low-risk auto-run. Both this AND the dashboard setting must be on. */
  autoRunLow: z.boolean().default(false),
  extraWorkspaces: z.array(z.string()).default([]),
  /** Experimental headless Claude Code for free-form command steps. Off unless the person turns it on. */
  headlessClaude: z.boolean().default(false),
  snapshotRetentionDays: z.number().int().min(1).max(365).default(30),
});
export type AgentConfig = z.infer<typeof ConfigSchema>;

export function ensureDirs(p: AgentPaths): void {
  for (const dir of [p.stateDir, p.logsDir, p.snapshotsDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(p.workspace, { recursive: true });
  // Marker that bounds package-manager config lookups (see checkPackageManagerConfig).
  const marker = `${p.workspace}/.aop-inbox-workspace`;
  if (!existsSync(marker)) writeFileSync(marker, "AOP Inbox agent workspace. Setups run here by default.\n");
}

export function loadConfig(p: AgentPaths): AgentConfig | null {
  if (!existsSync(p.configFile)) return null;
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(p.configFile, "utf8")));
  if (!parsed.success) throw new Error(`~/.aop-inbox/config.json is invalid: ${parsed.error.issues[0]?.message}. Run \`aop-inbox doctor\`.`);
  return parsed.data;
}

export function saveConfig(p: AgentPaths, config: AgentConfig): void {
  const tmp = `${p.configFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(ConfigSchema.parse(config), null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p.configFile);
  chmodSync(p.configFile, 0o600);
}
