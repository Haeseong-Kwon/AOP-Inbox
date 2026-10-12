import path from "node:path";
import { analyzeCommand, maxRisk } from "./command";
import type { Risk } from "./setup-spec";
import type { Change } from "./setup-spec";

/**
 * Content-aware risk for structured file changes. Some "config" files are
 * code: Claude Code settings can define hooks and status-line commands, package
 * manifests define install scripts, shell profiles run on every new shell.
 */

// Claude Code settings: ALLOWLIST of keys known to be inert. Anything else (hooks, statusLine,
// apiKeyHelper, permissions, env, MCP flags, and keys added in future versions) is treated as code.
const CLAUDE_SAFE_KEYS = new Set(["model", "theme", "outputStyle", "includeCoAuthoredBy", "cleanupPeriodDays", "alwaysThinkingEnabled", "spinnerTipsEnabled", "verbose", "language", "preferredNotifChannel"]);

// Files whose contents are plain data for people; everything else may be read by some tool.
const DATA_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".log", ".html", ".css", ".svg", ".png", ".jpg", ".jpeg", ".gif"]);

const EXECUTABLE_FILE = [
  /(^|\/)\.mcp\.json$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.husky(\/|$)/,
  /(^|\/)\.vscode\/(tasks|launch|settings)\.json$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.pnpmfile\.(c|m)?js$/,
  /(^|\/)(\.?mise(\.local)?\.toml|\.tool-versions|\.mise\/|bunfig\.toml|\.yarnrc(\.yml)?|\.npmrc|pyproject\.toml|setup\.(py|cfg)|tox\.ini|noxfile\.py|brewfile|docker-compose\.ya?ml|compose\.ya?ml|dockerfile|\.devcontainer\/|deno\.jsonc?|\.babelrc|babel\.config\.\w+|\.prettierrc[\w.]*|\.eslintrc[\w.]*|tsconfig[\w.-]*\.json|jest\.config\.\w+|vite\.config\.\w+|\.direnv\/|\.idea\/|\.zed\/|\.cursor\/|\.windsurf\/|\.vscode\/)/,
  /(^|\/)(Makefile|justfile|Taskfile\.ya?ml|Rakefile|Procfile)$/,
  /(^|\/)(\.github\/workflows)\//,
  /\.(sh|bash|zsh|command|tool|scpt|applescript|plist|py|rb|pl|js|mjs|cjs|ts)$/,
];

/**
 * Shell-profile allowlist. Environment variables are an execution channel
 * (NODE_OPTIONS, DYLD_*, BASH_ENV, PROMPT_COMMAND, GIT_SSH_COMMAND, EDITOR,
 * proxies, CA bundles…), so only tool-location variables and PATH pass, and
 * only with absolute or $HOME-based paths.
 */
const ABS_PATH = String.raw`(?:\$HOME|~)?/[A-Za-z0-9_./-]*`;
const TOOL_LOCATION = new RegExp(String.raw`^export ([A-Z][A-Z0-9_]*_(?:HOME|DIR|ROOT|INSTALL)|GOPATH)="?(${ABS_PATH})"?$`);
const PATH_EXPORT = new RegExp(String.raw`^export PATH="((?:${ABS_PATH}|\$PATH)(?::(?:${ABS_PATH}|\$PATH))*)"$`);

// Tools execute binaries from these locations, so they must not point anywhere content can write to:
// the AOP Inbox workspace (cloned repos land there), temp folders, Downloads/Desktop.
const UNTRUSTED_LOCATION = /(^|\/)aop-inbox-workspace(\/|$)|^\/(tmp|private|var|dev|volumes)(\/|$)|^(\$home|~)\/(downloads|desktop)(\/|$)/i;

function trustedLocation(seg: string): boolean {
  const parts = seg.split("/");
  return !parts.includes("..") && !parts.includes(".") && !UNTRUSTED_LOCATION.test(seg);
}

function safeProfileLine(line: string): boolean {
  const tool = line.match(TOOL_LOCATION);
  if (tool) return trustedLocation(tool[2]);
  const p = line.match(PATH_EXPORT);
  if (!p) return false;
  return p[1].split(":").every((seg) => seg === "$PATH" || trustedLocation(seg));
}

export interface ChangeRisk {
  risk: Risk;
  reasons: string[];
}

function keysDeep(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => [prefix ? `${prefix}.${k}` : k, ...keysDeep(v, prefix ? `${prefix}.${k}` : k)]);
}

/**
 * `resolved` is the absolute path after expansion (and realpath on the device).
 * Matching is case-insensitive because APFS is: `.CLAUDE/` is `.claude/`.
 */
export function changeRisk(change: Change, zone: string, resolved: string = change.path, workspaceRelative?: string): ChangeRisk {
  const reasons: string[] = [];
  let risk: Risk = "low";
  const raise = (r: Risk, reason: string) => {
    risk = maxRisk(risk, r);
    reasons.push(reason);
  };
  const p = path.posix.normalize(resolved.replace(/\\/g, "/")).toLowerCase();
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
      const bad = [...new Set(keys.map((k) => k.split(".")[0]))].filter((k) => !CLAUDE_SAFE_KEYS.has(k));
      if (bad.length) raise("high", `Changes Claude Code ${bad.join(", ")}, which AOP Inbox treats as able to run commands or change permissions`);
    }
    if (base === ".claude.json") raise("high", "~/.claude.json is managed by Claude Code; MCP servers are added with an MCP step, not by editing it");
    if (base === "package.json" && keys.some((k) => /^(scripts|bin|config|pnpm|overrides|resolutions)(\.|$)/.test(k))) {
      raise("high", "Adds package scripts or install hooks, which run code");
    }
  }

  // Tools auto-load hidden files and folders (.envrc, .npmrc, .vscode/, .devcontainer/, .mise.toml…).
  // Rather than naming them all, any hidden path component written by a setup counts as code.
  // Relative to the workspace root that actually contains it (computed by the policy engine);
  // without that, every component of the absolute path is checked — stricter, never looser.
  const rel = (workspaceRelative ?? p).replace(/\\/g, "/").toLowerCase();
  if (zone === "workspace" && rel.split("/").some((part) => part.startsWith(".") && part !== "." && part !== "..")) {
    raise("high", `${base} is in a hidden location that tools load automatically`);
  }
  if (zone === "workspace" && !DATA_EXTENSIONS.has(path.posix.extname(p))) {
    raise("medium", `Other tools may read ${base}, so it needs your review`);
  }

  const text = change.kind === "file_write" ? change.content : change.kind === "append_line" ? change.line : "";
  if (/^#!/.test(text)) raise("high", "Writes an executable script");

  if (zone === "shell_profile") {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const line of lines) {
      if (!safeProfileLine(line)) {
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
