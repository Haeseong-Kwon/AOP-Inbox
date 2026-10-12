import type { Risk } from "./setup-spec";

/**
 * Structured shell-command analysis. We tokenize like a POSIX shell (quotes,
 * escapes, operators, substitutions, redirects) instead of grepping strings, so
 * `su""do`, `$(echo c3Vkbw==|base64 -d)` or `curl x|sh` can't hide.
 *
 * The agent only ever executes commands that parse into simple argv segments
 * joined by `&&`. Anything needing a real shell is classified high and shown as
 * manual instructions.
 */

export type Operator = "|" | "||" | "&&" | ";" | "&";

export interface Segment {
  argv: string[];
  /** tokens that contained an unquoted $VAR, $(…), `…`, glob, or ~user expansion */
  dynamic: boolean;
  redirects: { op: string; target: string }[];
  env: Record<string, string>;
}

export interface ParsedCommand {
  segments: Segment[];
  operators: Operator[];
  substitution: boolean;
  processSubstitution: boolean;
  heredoc: boolean;
  error?: string;
}

const OPERATOR_CHARS = new Set(["|", "&", ";", "\n"]);

export function parseCommand(input: string): ParsedCommand {
  const result: ParsedCommand = { segments: [], operators: [], substitution: false, processSubstitution: false, heredoc: false };
  let segment: Segment = { argv: [], dynamic: false, redirects: [], env: {} };
  let token = "";
  let inToken = false;
  let tokenDynamic = false;
  let pendingRedirect: string | null = null;

  const pushToken = () => {
    if (!inToken) return;
    if (pendingRedirect) {
      segment.redirects.push({ op: pendingRedirect, target: token });
      pendingRedirect = null;
    } else if (segment.argv.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      const eq = token.indexOf("=");
      segment.env[token.slice(0, eq)] = token.slice(eq + 1);
    } else {
      segment.argv.push(token);
    }
    if (tokenDynamic) segment.dynamic = true;
    token = "";
    inToken = false;
    tokenDynamic = false;
  };
  const pushSegment = (op?: Operator) => {
    pushToken();
    if (segment.argv.length || Object.keys(segment.env).length || segment.redirects.length) result.segments.push(segment);
    if (op) result.operators.push(op);
    segment = { argv: [], dynamic: false, redirects: [], env: {} };
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "\\") {
      // Line continuation or escaped char.
      if (input[i + 1] === "\n") {
        i++;
        continue;
      }
      token += input[i + 1] ?? "";
      inToken = true;
      i++;
    } else if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) return { ...result, error: "unterminated single quote" };
      token += input.slice(i + 1, end);
      inToken = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < input.length && input[j] !== '"'; j++) {
        if (input[j] === "\\") {
          token += input[j + 1] ?? "";
          j++;
          continue;
        }
        if (input[j] === "$" || input[j] === "`") {
          tokenDynamic = true;
          if (input[j + 1] === "(" || input[j] === "`") result.substitution = true;
        }
        token += input[j];
      }
      if (j >= input.length) return { ...result, error: "unterminated double quote" };
      inToken = true;
      i = j;
    } else if (c === " " || c === "\t") {
      pushToken();
    } else if (OPERATOR_CHARS.has(c)) {
      const two = input.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        pushSegment(two);
        i++;
      } else if (c === "&" && input[i + 1] === ">") {
        pushToken();
        pendingRedirect = "&>";
        i++;
      } else {
        pushSegment(c === "\n" ? ";" : (c as Operator));
      }
    } else if (c === ">" || c === "<") {
      // fd prefix like 2> stays attached to the operator
      if (inToken && /^\d+$/.test(token)) {
        token = "";
        inToken = false;
      } else pushToken();
      if (c === "<" && input[i + 1] === "(") {
        result.processSubstitution = true;
        tokenDynamic = true;
      }
      if (c === "<" && input[i + 1] === "<") result.heredoc = true;
      let op = c;
      while (input[i + 1] === ">" || input[i + 1] === "&" || input[i + 1] === "<") op += input[++i];
      pendingRedirect = op;
    } else if (c === "#" && !inToken) {
      // A shell would ignore the rest of the line; we refuse to guess.
      return { ...result, error: "contains a shell comment" };
    } else if (c === "$" || c === "`") {
      tokenDynamic = true;
      if (c === "`" || input[i + 1] === "(") result.substitution = true;
      token += c;
      inToken = true;
    } else {
      if (c === "*" || c === "?" || c === "[" || c === "{" || c === "!" || (c === "~" && !inToken && input[i + 1] && /[A-Za-z]/.test(input[i + 1]))) tokenDynamic = true;
      token += c;
      inToken = true;
    }
  }
  pushSegment();
  return result;
}

/** True when the command can be executed as argv lists without a shell. */
export function isSimpleCommand(parsed: ParsedCommand): boolean {
  return (
    !parsed.error &&
    !parsed.substitution &&
    !parsed.processSubstitution &&
    !parsed.heredoc &&
    parsed.segments.length > 0 &&
    parsed.operators.every((op) => op === "&&") &&
    parsed.segments.every((s) => s.redirects.length === 0 && !s.dynamic && Object.keys(s.env).length === 0)
  );
}

export const commandName = (argv: string[]): string => (argv[0] ?? "").split("/").pop()!.toLowerCase();

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "pwsh"]);
const INTERPRETERS = new Set([...SHELLS, "python", "python3", "node", "perl", "ruby", "php", "osascript", "deno", "bun", "tclsh", "lua"]);
const PRIVILEGE = new Set(["sudo", "doas", "su", "pkexec", "runas"]);
const SYSTEM_TOOLS = new Set([
  "osascript", "launchctl", "csrutil", "spctl", "networksetup", "scutil", "systemsetup", "dscl", "nvram", "pfctl",
  "diskutil", "mkfs", "dd", "fdisk", "shutdown", "reboot", "halt", "kextload", "tccutil", "sysadminctl", "chflags",
  "iptables", "ufw", "ifconfig", "route", "crontab", "at", "visudo",
]);
const EXFIL_TOOLS = new Set(["scp", "sftp", "rsync", "nc", "ncat", "netcat", "socat", "telnet", "ftp", "ssh", "ssh-add", "ssh-keygen"]);
// Commands with no file arguments and no way to launch others.
const READ_ONLY = new Set(["echo", "pwd", "which", "whoami", "uname", "date", "true", "false", "sw_vers"]);
// Read files: low only when every path argument stays inside the workspace (output is reported back).
export const FILE_READERS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "stat", "file", "diff"]);
// Run another program given as arguments — the inner program is unknowable here.
const WRAPPERS = new Set(["env", "xargs", "nohup", "time", "timeout", "gtimeout", "nice", "renice", "command", "exec", "builtin", "caffeinate", "script", "watch", "parallel", "stdbuf", "unbuffer", "arch", "open"]);
const NODE_PMS = new Set(["npm", "pnpm", "yarn", "bun"]);
// Commands classified by the dedicated checks at the top of analyzeSegment.
const HANDLED_ABOVE = new Set(["rm", "curl", "wget", "chmod", "chown", "security", "eval", "source", ".", "base64", "xxd", "find", "defaults", "printenv"]);
const OFFICIAL_REGISTRIES = ["https://registry.npmjs.org", "https://registry.yarnpkg.com", "https://pypi.org"];

/** Paths that must never be read or written by an automated step. */
export const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|[\s/"'=@:])~?\/?\.ssh(\/|$|\b)/i,
  /library\/keychains/i,
  /\.aws(\/|\b)/i,
  /\.config\/gcloud/i,
  /\.azure(\/|\b)/i,
  /\.kube\/config/i,
  /\.docker\/config\.json/i,
  /\.netrc\b/i,
  /\.npmrc\b/i,
  /\.pypirc\b/i,
  /\.gnupg(\/|\b)/i,
  /\.git-credentials/i,
  /\/etc\/(shadow|sudoers|passwd|master\.passwd)/i,
  /library\/application support\/(google\/chrome|chromium|firefox|brave|arc|microsoft edge|vivaldi|com\.operasoftware)/i,
  /library\/(cookies|safari)/i,
  /mozilla\/firefox\/profiles/i,
  /\bid_(rsa|ed25519|ecdsa|dsa)\b/i,
  /\.env(\.local|\.production)?\b/,
];

export function referencesSensitivePath(text: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(text));
}

export interface CommandAnalysis {
  risk: Risk;
  /** Hard deny: never runnable, even manually through AOP Inbox. */
  denied: boolean;
  /** Runnable by the agent as argv (no shell). */
  executable: boolean;
  reasons: string[];
  /** Paths the command would write to (redirect targets, mkdir/cp/mv/touch targets). */
  writes: string[];
  /** Packages it installs, for "Installed …" summaries and conflict checks. */
  installs: string[];
  /** Human category for the review UI. */
  kind: "read_only" | "package_install" | "mcp_register" | "file_write" | "download" | "remote_exec" | "system" | "other";
}

const RISK_ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
export const maxRisk = (...risks: Risk[]): Risk => risks.reduce((a, b) => (RISK_ORDER[b] > RISK_ORDER[a] ? b : a), "low");

function flagValue(argv: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    for (const n of names) {
      if (argv[i] === n) return argv[i + 1];
      if (argv[i].startsWith(`${n}=`)) return argv[i].slice(n.length + 1);
    }
  }
  return undefined;
}

const positional = (argv: string[]) => argv.slice(1).filter((a) => !a.startsWith("-"));

/** A path argument that provably stays inside the working directory (relative, no `..`, no `~`). */
const staysLocal = (arg: string) => !arg.startsWith("/") && !arg.startsWith("~") && !arg.split("/").includes("..");

function analyzeSegment(seg: Segment, out: CommandAnalysis, previous?: Segment) {
  const name = commandName(seg.argv);
  const args = seg.argv.slice(1);
  const raise = (risk: Risk, reason: string, deny = false) => {
    out.risk = maxRisk(out.risk, risk);
    out.reasons.push(reason);
    if (deny) out.denied = true;
  };

  if (!name) return;
  if (seg.dynamic) raise("high", "Uses shell expansion ($VAR, globs or substitution), so the real command isn't known in advance");
  for (const key of Object.keys(seg.env)) {
    if (/^(PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_\w+|NODE_OPTIONS|BASH_ENV|ENV|PROMPT_COMMAND)$/.test(key)) {
      raise("high", `Overrides ${key}, which can change what actually runs`);
    }
  }
  if (PRIVILEGE.has(name)) raise("high", "Requires administrator (sudo/root) privileges", true);
  if (SYSTEM_TOOLS.has(name)) raise("high", `Changes system settings (${name})`, name === "osascript" || name === "csrutil" || name === "tccutil" || name === "nvram");
  if (EXFIL_TOOLS.has(name)) raise("high", `Opens a remote connection or touches SSH (${name})`, name.startsWith("ssh"));
  if (name === "security" && args.some((a) => /dump-keychain|find-(generic|internet)-password|export/.test(a))) {
    raise("high", "Reads secrets from the macOS Keychain", true);
  }
  if (name === "eval" || name === "source" || name === ".") raise("high", "Evaluates code built at runtime", true);
  if (SHELLS.has(name) && args.some((a) => a === "-c" || a.startsWith("-c"))) raise("high", "Runs a nested shell command (sh -c)");
  if (SHELLS.has(name) || (INTERPRETERS.has(name) && name !== "node" && name !== "python" && name !== "python3")) {
    if (!(args.length === 1 && /^(--version|-v|-V)$/.test(args[0]))) raise("high", `Runs code with ${name}`);
  }
  if (WRAPPERS.has(name)) raise("high", `Launches another program through ${name}, so what actually runs isn't checked`);
  if (name === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint)/.test(a))) raise("high", "find with -exec/-delete runs commands or deletes files");
  else if (name === "find") raise(args.every((a) => a.startsWith("-") || staysLocal(a)) ? "low" : "medium", "Searches files");
  if (name === "defaults" && args[0] !== "read") raise("high", "Changes macOS system preferences");
  if (name === "printenv") raise("high", "Prints environment variables, which often hold secrets");
  if (INTERPRETERS.has(name) && args.some((a) => a === "-e" || a === "-c" || a === "--eval")) raise("high", `Runs inline ${name} code`);

  // Pipe into an interpreter: curl … | sh, base64 -d | bash, etc.
  if (previous && INTERPRETERS.has(name)) {
    const prev = commandName(previous.argv);
    const remote = prev === "curl" || prev === "wget" || prev === "fetch";
    raise("high", remote ? "Downloads a script and runs it immediately (curl | sh)" : "Pipes data into an interpreter", true);
    out.kind = "remote_exec";
  }
  if ((name === "base64" && args.some((a) => a === "-d" || a === "-D" || a === "--decode")) || (name === "xxd" && args.includes("-r"))) {
    raise("high", "Decodes hidden content (common obfuscation)", true);
  }

  if (name === "rm") {
    const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive");
    const targets = positional(seg.argv);
    const catastrophic = targets.some((t) => /^(\/|~\/?|\$HOME\/?|\/\*|\*|\.\.?\/?|\/(Users|System|Library|usr|etc|bin|var)\/?)$/.test(t));
    if (catastrophic) raise("high", "Deletes a system or home directory", true);
    else if (recursive) raise("high", "Recursively deletes files");
    else raise("medium", "Deletes files");
    out.writes.push(...targets);
  }

  if (name === "chmod" || name === "chown") {
    const targets = positional(seg.argv).slice(1);
    if (targets.some((t) => t.startsWith("/") && !t.startsWith("/tmp"))) raise("high", "Changes permissions on system files");
    else raise("medium", "Changes file permissions");
    out.writes.push(...targets);
  }

  if (name === "curl" || name === "wget") {
    out.kind = out.kind === "remote_exec" ? out.kind : "download";
    const uploads = args.some((a) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--post-file|--post-data|-X)$/.test(a.split("=")[0]));
    if (uploads) raise("high", "Sends data to a remote server", true);
    if (args.some((a) => a.startsWith("@") && referencesSensitivePath(a))) raise("high", "Uploads a credential file", true);
    const output = flagValue(seg.argv, "-o", "--output", "--output-document");
    if (output) out.writes.push(output);
    raise("medium", "Downloads from the internet");
  }

  if (NODE_PMS.has(name) && ["install", "i", "add", "global"].includes(args[0] ?? "")) {
    out.kind = "package_install";
    const global = args.includes("-g") || args.includes("--global") || args[0] === "global";
    const registry = flagValue(seg.argv, "--registry");
    const prefix = flagValue(seg.argv, "--prefix", "-C", "--dir", "--cwd", "--global-dir", "--modules-folder", "--cache");
    if (prefix) {
      out.writes.push(prefix);
      if (!staysLocal(prefix)) raise("medium", "Installs into a folder outside the workspace");
    }
    const pkgs = positional(seg.argv).slice(args[0] === "global" ? 2 : 1);
    out.installs.push(...pkgs);
    if (registry && !OFFICIAL_REGISTRIES.some((r) => registry.startsWith(r))) raise("high", `Installs from an unofficial registry (${registry})`);
    // Registry specs look like `name`, `@scope/name`, optionally `@version`. Anything else is a path, URL, tarball or repo.
    const registrySpec = (p: string) =>
      /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=| -]+)?$/i.test(p) && !/\.(tgz|tar|tar\.gz|zip)$/i.test(p);
    if (pkgs.some((p) => /^https?:/.test(p) && !/^https:\/\/(github\.com|codeload\.github\.com)\//.test(p))) {
      raise("high", "Installs from an arbitrary URL");
    } else if (pkgs.some((p) => !registrySpec(p))) {
      raise("medium", "Installs from a local path, tarball or Git repository instead of the registry");
    }
    // Install scripts (postinstall…) run arbitrary code; only script-free installs are low.
    const noScripts = args.includes("--ignore-scripts");
    if (global) raise("medium", "Installs a global package (changes your whole machine)");
    else if (!noScripts) raise("medium", "Package install scripts can run code on your Mac");
    else if (pkgs.length === 0) raise("low", "Installs project dependencies without running install scripts");
    else raise("low", "Installs a package from the official registry into the workspace, without install scripts");
  } else if (name === "npx" || name === "pnpx" || (name === "pnpm" && args[0] === "dlx") || (name === "bunx")) {
    raise("medium", "Downloads and runs a package's code");
  } else if (name === "brew") {
    if (args[0] === "install" || args[0] === "reinstall" || args[0] === "upgrade") {
      out.kind = "package_install";
      out.installs.push(...positional(seg.argv).slice(1));
      raise("medium", "Installs software with Homebrew");
    } else if (args[0] === "tap") raise("high", "Adds a third-party Homebrew source");
    else if (["list", "info", "--version", "search"].includes(args[0] ?? "")) raise("low", "Reads Homebrew state");
    else raise("medium", `Runs brew ${args[0] ?? ""}`.trim());
  } else if (name === "pip" || name === "pip3" || name === "pipx" || (name === "uv" && ["pip", "tool"].includes(args[0] ?? ""))) {
    if (args.includes("install")) {
      out.kind = "package_install";
      const idx = args.indexOf("install");
      out.installs.push(...args.slice(idx + 1).filter((a) => !a.startsWith("-")));
      const pipPkgs = args.slice(idx + 1).filter((a) => !a.startsWith("-"));
      if (pipPkgs.some((p) => /^(https?:|git\+|file:|\.{0,2}\/)/.test(p))) {
        raise(pipPkgs.some((p) => /^https?:/.test(p) && !/github\.com/.test(p)) ? "high" : "medium", "Installs from a URL or path instead of PyPI");
      }
      const index = flagValue(seg.argv, "--index-url", "-i", "--extra-index-url");
      if (index && !OFFICIAL_REGISTRIES.some((r) => index.startsWith(r))) raise("high", "Installs from an unofficial package index");
      raise("medium", "Installs a Python package");
    } else raise("medium", `Runs ${name} ${args[0] ?? ""}`.trim());
  } else if (name === "claude") {
    if (args[0] === "mcp" && args[1] === "add") {
      out.kind = "mcp_register";
      const scope = flagValue(seg.argv, "-s", "--scope") ?? "local";
      // The server command after `--` runs later inside Claude Code; analyze it as a command of its own.
      const dashdash = seg.argv.indexOf("--");
      if (dashdash >= 0) {
        const inner = analyzeArgv(seg.argv.slice(dashdash + 1));
        if (inner.denied || inner.risk === "high") raise("high", `MCP server command: ${inner.reasons[0] ?? "not allowed"}`, inner.denied);
        else if (inner.risk === "medium") raise("medium", `MCP server command: ${inner.reasons[0] ?? "runs code"}`);
        else raise("medium", "The MCP server runs a program whenever Claude Code starts it");
      } else if (!args.some((a) => /^https:\/\//.test(a))) {
        raise("high", "MCP server command isn't separated with --, so it can't be checked");
      }
      if (args.includes("-e") || args.includes("--env") || args.some((a) => /^(-H|--header)$/.test(a))) {
        raise("medium", "Stores environment variables or headers for the MCP server");
      }
      raise(scope === "project" ? "low" : "medium", scope === "project" ? "Registers an MCP server for the workspace project" : "Changes your Claude Code configuration (~/.claude.json)");
    } else if (args[0] === "mcp" && ["list", "get"].includes(args[1] ?? "")) {
      out.kind = "read_only";
      raise("low", "Reads Claude Code MCP configuration");
    } else if (args[0] === "mcp" && args[1] === "remove") raise("medium", "Removes an MCP server from Claude Code");
    else if (args[0] === "mcp" && args[1] === "add-json") raise("high", "Registers an MCP server from raw JSON");
    else if (args[0] === "--version" || args[0] === "-v" || args[0] === "doctor") raise("low", "Checks Claude Code");
    else raise("high", "Runs Claude Code with a free-form task");
  } else if (name === "git") {
    if (args.some((a) => /^(-c|--config-env|--upload-pack|--receive-pack|--exec|-u|--template|--separate-git-dir)(=|$)/.test(a) || /core\.(sshcommand|hookspath|pager|editor|fsmonitor)|ext::|fd::/i.test(a))) {
      raise("high", "Git options that can run arbitrary programs");
    }
    if (args.some((a) => /^(-C|--git-dir|--work-tree|--output|-o)(=|$)/.test(a))) raise("medium", "Points Git at another folder or writes its output to a file");
    if (args[0] === "clone") {
      const [url = "", dir] = positional(seg.argv).slice(1);
      if (dir) out.writes.push(dir);
      raise(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url) ? "low" : "medium", "Clones a repository into the workspace");
    } else if (["status", "log", "diff", "--version"].includes(args[0] ?? "")) raise("low", "Reads Git state");
    else if (args[0] === "config" && args.includes("--global")) raise("medium", "Changes your global Git configuration");
    else raise("medium", `Runs git ${args[0] ?? ""}`.trim());
  } else if (["mkdir", "touch", "cp", "mv", "ln", "tee"].includes(name)) {
    out.kind = "file_write";
    const targets = positional(seg.argv);
    // mv removes its sources, so every path counts; cp/ln only write the destination.
    out.writes.push(...(name === "cp" || name === "ln" ? targets.slice(-1) : targets));
    if ((name === "cp" || name === "ln") && !targets.slice(0, -1).every(staysLocal)) {
      raise("medium", `${name === "cp" ? "Copies" : "Links"} files from outside the workspace`);
    }
    if (name === "ln") raise("medium", "Creates a link that can redirect file access");
    else raise("low", `Creates or changes files (${name})`);
  } else if (name === "node" || name === "python" || name === "python3") {
    if (args.length === 1 && /^(--version|-v|-V)$/.test(args[0])) {
      out.kind = "read_only";
      raise("low", `Checks the installed ${name} version`);
    } else raise("medium", `Runs a ${name} program`);
  } else if (FILE_READERS.has(name)) {
    if (args.some((a) => /^--(pre|pre-glob|search-zip)(=|$)|^-z$/.test(a))) raise("high", `${name} option that runs another program`);
    const pathArgs = positional(seg.argv).slice(name === "grep" || name === "rg" ? 1 : 0);
    const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a));
    if (pathArgs.every(staysLocal) && !(recursive && pathArgs.length === 0 && name !== "ls")) {
      out.kind = "read_only";
      raise("low", "Reads files in the workspace");
    } else raise("medium", "Reads files outside the workspace (their contents are reported back)");
  } else if (READ_ONLY.has(name)) {
    if (out.kind === "other") out.kind = "read_only";
    raise("low", "Reads information only");
  } else if (name === "export") {
    raise("low", "Sets an environment variable for this session only");
  } else if (!HANDLED_ABOVE.has(name) && !PRIVILEGE.has(name) && !SYSTEM_TOOLS.has(name) && !EXFIL_TOOLS.has(name) && !INTERPRETERS.has(name)) {
    raise("medium", `Runs ${name}, which AOP Inbox doesn't recognise`);
  }

  if (seg.argv.some((a) => referencesSensitivePath(a)) || seg.redirects.some((r) => referencesSensitivePath(r.target))) {
    raise("high", "Touches credentials or private keys (SSH, cloud, browser or keychain data)", true);
  }
  for (const r of seg.redirects) {
    if (r.op.includes(">")) out.writes.push(r.target);
  }
}

/** Analyze an argv that never went through a shell (MCP server commands, structured specs). */
export function analyzeArgv(argv: string[]): CommandAnalysis {
  const out: CommandAnalysis = { risk: "low", denied: false, executable: true, reasons: [], writes: [], installs: [], kind: "other" };
  analyzeSegment({ argv, dynamic: argv.some((a) => /[$`*?[{]/.test(a)), redirects: [], env: {} }, out);
  out.reasons = [...new Set(out.reasons)];
  out.executable = !out.denied;
  return out;
}

/**
 * Classify a command. Never throws; an unparseable command is high risk and not executable.
 */
export function analyzeCommand(command: string): CommandAnalysis {
  const out: CommandAnalysis = { risk: "low", denied: false, executable: false, reasons: [], writes: [], installs: [], kind: "other" };
  const normalized = command.normalize("NFKC");
  if (/[\u0000-\u0008\u000b-\u001f\u007f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/.test(normalized)) {
    out.risk = "high";
    out.denied = true;
    out.reasons.push("Contains invisible or control characters");
    return out;
  }
  const parsed = parseCommand(normalized);
  if (parsed.error) {
    out.risk = "high";
    out.reasons.push(`Can't be parsed safely (${parsed.error})`);
    return out;
  }
  parsed.segments.forEach((seg, i) => {
    const pipedFrom = i > 0 && parsed.operators[i - 1] === "|" ? parsed.segments[i - 1] : undefined;
    analyzeSegment(seg, out, pipedFrom);
  });
  if (parsed.substitution || parsed.processSubstitution) {
    out.risk = "high";
    out.reasons.push("Builds part of the command at runtime ($(…) or backticks)");
  }
  if (parsed.heredoc) {
    out.risk = maxRisk(out.risk, "high");
    out.reasons.push("Feeds inline content to a program (heredoc)");
  }
  if (parsed.operators.includes("|") && !out.denied) {
    out.risk = maxRisk(out.risk, "high");
    out.reasons.push("Pipes output between programs, which needs a real shell");
  }
  if (parsed.operators.some((op) => op === ";" || op === "||" || op === "&")) {
    out.risk = maxRisk(out.risk, "high");
    out.reasons.push("Chains commands in ways AOP Inbox doesn't run automatically");
  }
  if (parsed.segments.some((s) => s.redirects.length > 0)) {
    out.risk = maxRisk(out.risk, "medium");
    out.reasons.push("Writes output to a file through the shell");
  }
  out.executable = isSimpleCommand(parsed) && !out.denied;
  if (!out.executable && !out.denied && out.risk !== "high") {
    out.risk = "high";
    out.reasons.push("Needs a real shell to run, so it's shown as manual instructions");
  }
  out.reasons = [...new Set(out.reasons)];
  return out;
}

/** argv lists for an executable command (segments joined by &&). Throws if it isn't simple. */
export function toArgvList(command: string, home?: string): string[][] {
  const parsed = parseCommand(command.normalize("NFKC"));
  if (!isSimpleCommand(parsed)) throw new Error("Command needs a shell; refusing to run it");
  // A shell would expand a leading ~/ — do the same, and only that, so we run what was analyzed.
  const expand = (a: string) => (home && (a === "~" || a.startsWith("~/")) ? home + a.slice(1) : a);
  return parsed.segments.map((s) => s.argv.map(expand));
}
