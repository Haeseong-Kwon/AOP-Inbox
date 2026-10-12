import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where the device token lives. macOS Keychain in production; memory in tests. */
export interface TokenStore {
  get(account: string): Promise<string | null>;
  set(account: string, token: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const SERVICE = "aop-inbox-agent";

export const keychainStore: TokenStore = {
  async get(account) {
    try {
      const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },
  async set(account, token) {
    // Residual risk: the token is briefly visible in this process's argv to the same user. Documented in docs/threat-model.md.
    await run("/usr/bin/security", ["add-generic-password", "-s", SERVICE, "-a", account, "-w", token, "-U", "-T", ""]);
  },
  async delete(account) {
    try {
      await run("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    } catch {
      // already gone
    }
  },
};

export function memoryStore(initial: Record<string, string> = {}): TokenStore {
  const map = new Map(Object.entries(initial));
  return {
    get: async (a) => map.get(a) ?? null,
    set: async (a, t) => void map.set(a, t),
    delete: async (a) => void map.delete(a),
  };
}

export const tokenAccount = (server: string) => new URL(server).host;
