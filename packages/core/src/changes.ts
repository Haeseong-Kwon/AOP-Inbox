import path from "node:path";
import { analyzeCommand, maxRisk } from "./command";
import type { Risk } from "./setup-spec";
import type { Change } from "./setup-spec";

/**
 * Content-aware risk for structured file changes. Some "config" files are
 * code: Claude Code settings can define hooks and status-line commands, package
 * manifests define install scripts, shell profiles run on every new shell.
 */

// Claude Code settings keys that execute commands or weaken permission checks.
const CLAUDE_DANGEROUS_KEYS = /^(hooks|statusLine|apiKeyHelper|awsAuthRefresh|awsCredentialExport|otelHeadersHelper|permissions|env|enableAllProjectMcpServers|enabledMcpjsonServers|mcpServers|defaultMode|additionalDirectories|forceLoginMethod)$/;

const EXECUTABLE_FILE = [
  /(^|\/)\.mcp\.json$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.husky(\/|$)/,
  /(^|\/)\.vscode\/(tasks|launch|settings)\.json$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.pnpmfile\.(c|m)?js$/,
  /(^|\/)(Makefile|justfile|Taskfile\.ya?ml|Rakefile|Procfile)$/,
  /(^|\/)(\.github\/workflows)\//,
  /\.(sh|bash|zsh|command|tool|scpt|applescript|plist|py|rb|pl|js|mjs|cjs|ts)$/,
];

const SIMPLE_EXPORT = /^export [A-Za-z_][A-Za-z0-9_]*=("[^"$`\\]*"|'[^']*'|[A-Za-z0-9_./:@%+=,-]*)$/;
// PATH additions referencing $HOME/$PATH are common and static enough to allow.
const PATH_SEGMENT = String.raw`(?:\$HOME|\$PATH|~)?[A-Za-z0-9_./-]*`;
const PATH_EXPORT = new RegExp(String.raw`^export PATH="${PATH_SEGMENT}(?::${PATH_SEGMENT})*"$`);

export interface ChangeRisk {
  risk: Risk;
  reasons: string[];
}

function keysDeep(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => [prefix ? `${prefix}.${k}` : k, ...keysDeep(v, prefix ? `${prefix}.${k}` : k)]);
}

export function changeRisk(change: Change, zone: string): ChangeRisk {
  const reasons: string[] = [];
  let risk: Risk = "low";
  const raise = (r: Risk, reason: string) => {
    risk = maxRisk(risk, r);
    reasons.push(reason);
  };
  const p = change.path.replace(/\\/g, "/");
  const base = path.posix.basename(p);

  if (EXECUTABLE_FILE.some((re) => re.test(p))) raise("high", `${base} is executed by other tools, so writing it is running code`);
  // Claude Code reads .claude/ on every session: settings are checked key by key below; anything else there
  // (CLAUDE.md, commands, agents, skills) would plant standing instructions — a persistent prompt-injection channel.
  if (/(^|\/)\.claude\//.test(p) && !/(^|\/)\.claude\/settings(\.local)?\.json$/.test(p)) {
    raise("high", `${base} changes instructions Claude Code follows in every session`);
  }
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(p) && change.kind !== "json_merge") {
    raise("high", "Replaces Claude Code settings wholesale instead of adding specific keys");
  }

  if (change.kind === "json_merge") {
    const keys = keysDeep(change.value);
    if (/(^|\/)settings(\.local)?\.json$/.test(p) && (zone === "claude_config" || /\.claude\//.test(p))) {
      const bad = keys.filter((k) => CLAUDE_DANGEROUS_KEYS.test(k.split(".")[0]));
      if (bad.length) raise("high", `Changes Claude Code ${[...new Set(bad.map((k) => k.split(".")[0]))].join(", ")}, which can run commands or bypass permission prompts`);
    }
    if (base === ".claude.json" && keys.some((k) => /^(mcpServers|projects)(\.|$)/.test(k))) {
      raise("high", "MCP servers must be added with an MCP step (claude mcp add), not by editing ~/.claude.json");
    }
    if (base === "package.json" && keys.some((k) => /^(scripts|bin|config|pnpm|overrides|resolutions)(\.|$)/.test(k))) {
      raise("high", "Adds package scripts or install hooks, which run code");
    }
  }

  const text = change.kind === "file_write" ? change.content : change.kind === "append_line" ? change.line : "";
  if (/^#!/.test(text)) raise("high", "Writes an executable script");

  if (zone === "shell_profile") {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const line of lines) {
      if (!(SIMPLE_EXPORT.test(line) || PATH_EXPORT.test(line))) {
        raise("high", "Adds a shell-profile line that runs code every time a terminal opens");
        break;
      }
    }
    if (change.kind === "file_write") raise("high", "Replaces your whole shell profile");
  }

  // Free-form text that contains commands is treated like the commands themselves.
  if (change.kind !== "json_merge" && text && zone !== "shell_profile") {
    for (const line of text.split("\n").slice(0, 50)) {
      if (/^\s*(\$ )?(curl|wget|sudo|bash|sh|eval)\b/.test(line)) {
        const a = analyzeCommand(line.replace(/^\s*\$\s*/, ""));
        if (a.risk === "high") raise("high", "The file contains a dangerous command");
      }
    }
  }
  return { risk, reasons };
}
