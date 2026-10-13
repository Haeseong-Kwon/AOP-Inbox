import { analyzeCommand, parseCommand, type ExtractedFacts } from "@aop-inbox/core";
import type { FactsDraft, SpecDraft, StepDraft } from "./llm-schemas";
import { mcpFromCommand } from "./postprocess";

/**
 * Deterministic stand-ins for the two LLM stages (offline mode, tests, evals).
 * They are deliberately literal: commands only come from lines that look like
 * commands, and every safety decision is still made by the policy engine.
 */

const COMMAND_START =
  /^(?:\$\s*)?((?:sudo\s+)?(?:npm|npx|pnpm|pnpx|yarn|bun|bunx|brew|pip3?|pipx|uvx?|claude|git|curl|wget|node|python3?|mkdir|touch|cp|mv|rm|chmod|cat|echo|export|docker|cargo|go|deno|security|osascript|ssh|scp|eval|bash|sh|zsh|env|xargs|ls|which|open)\s.*)$/i;
const ACCOUNT = /(api[ _-]?key|sign[ -]?up|회원가입|결제|subscribe|log ?in|로그인|oauth|발급|create an account|billing|token)/i;
const SUSPICIOUS = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts?)/i,
  /disregard (the |all )?(previous|prior|above|system)/i,
  /you are now|act as (an? )?(unrestricted|dan|jailbroken)|developer mode/i,
  /(system|hidden) prompt/i,
  /(upload|send|post|exfiltrat\w*|share)\b.{0,60}\b(api[ _-]?keys?|tokens?|secrets?|credentials?|passwords?|ssh|id_rsa|keychain)/i,
  /(read|cat|open|copy)\b.{0,30}(~\/\.ssh|id_rsa|id_ed25519|keychain|\.aws\/credentials)/i,
  /(이전|위의?) (지시|명령).{0,10}무시/,
  /(as an ai|ai (assistant|agent)s?,? (must|should|please))/i,
];
const GUIDE_GATE = /(?:comment|댓글)[^.\n]{0,40}?["“'‘]?([A-Za-z가-힣0-9]{2,20})["”'’]?[^.\n]{0,40}?(?:guide|가이드|dm|디엠|보내)/i;

function cleanCommand(line: string): string {
  return line.replace(/^\s*(?:\$|>|#)\s*/, "").replace(/[`]+/g, "").trim();
}

export function mockExtractFacts(text: string, source: "document" | "note" = "document"): FactsDraft {
  const lines = text.split(/\r?\n|(?<=\.)\s+(?=\$)/).map((l) => l.trim()).filter(Boolean);
  const commands: FactsDraft["commands"] = [];
  const inlineCode = [...text.matchAll(/`([^`\n]{3,300})`/g)].map((m) => m[1]);
  for (const candidate of [...lines, ...inlineCode]) {
    const m = cleanCommand(candidate).match(COMMAND_START);
    if (m && !commands.some((c) => c.text === m[1].trim())) commands.push({ t: null, text: m[1].trim(), source: "document" });
  }
  const suspiciousInstructions = lines.filter((l) => SUSPICIOUS.some((re) => re.test(l))).slice(0, 10);
  const tools = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][\w.-]{1,30})\s+MCP\b/g)) tools.add(`${m[1]} MCP`);
  for (const c of commands) tools.add(c.text.split(/\s+/)[0]);
  const gate = text.match(GUIDE_GATE);
  void source;
  return {
    title: null,
    creator: null,
    speech: [],
    screenText: [],
    toolsMentioned: [...tools].slice(0, 30),
    commands: commands.slice(0, 30),
    links: [...new Set(text.match(/https?:\/\/[^\s<>"'`)]+/g) ?? [])].slice(0, 30),
    accountRequirements: lines.filter((l) => ACCOUNT.test(l) && !COMMAND_START.test(cleanCommand(l))).slice(0, 5),
    guideGate: gate ? { keyword: gate[1], quote: gate[0].slice(0, 300) } : null,
    suspiciousInstructions,
  };
}

function slug(text: string, used: Set<string>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "step";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
}

function verifyFor(command: string): Pick<StepDraft, "verifyRecipe" | "verifyArgs"> {
  const argv = parseCommand(command).segments[0]?.argv ?? [];
  const [cmd, sub, ...rest] = argv;
  const pkg = rest.find((a) => !a.startsWith("-"));
  if (cmd === "node" && /^(-v|--version)$/.test(sub ?? "")) return { verifyRecipe: "node-installed", verifyArgs: [] };
  if (cmd === "npm" && /^(i|install|add)$/.test(sub ?? "") && pkg) {
    const global = argv.includes("-g") || argv.includes("--global");
    return { verifyRecipe: "package-installed", verifyArgs: [{ key: "manager", value: global ? "npm-global" : "npm" }, { key: "name", value: pkg.replace(/@[^@/]*$/, "") || pkg }] };
  }
  if (cmd === "brew" && sub === "install" && pkg) return { verifyRecipe: "package-installed", verifyArgs: [{ key: "manager", value: "brew" }, { key: "name", value: pkg }] };
  if (cmd === "mkdir") {
    const dir = argv.slice(1).find((a) => !a.startsWith("-"));
    if (dir) return { verifyRecipe: "directory-exists", verifyArgs: [{ key: "path", value: dir }] };
  }
  return { verifyRecipe: null, verifyArgs: [] };
}

export function mockStructure(facts: ExtractedFacts, meta: { title?: string | null }): SpecDraft {
  const used = new Set<string>();
  const steps: StepDraft[] = [];
  const empty = { target: null, evidenceTimestampSec: null, change: null, version: null };

  for (const account of facts.accountRequirements) {
    steps.push({
      ...empty,
      id: slug("your-step", used),
      title: account.length > 60 ? `${account.slice(0, 57)}…` : account,
      type: "user_action",
      instruction: account,
      commands: [],
      needsUser: true,
      risk: "low",
      confidence: 0.8,
      evidenceQuote: account.slice(0, 300),
      evidenceSource: "document",
      verifyRecipe: null,
      verifyArgs: [],
      dependsOn: [],
      mcp: null,
      explain: { whatItDoes: account, whyNeeded: "Only you can do this.", whatChanges: "Nothing on your Mac", howToUndo: "Nothing to undo." },
    });
  }

  for (const fact of facts.commands) {
    const command = fact.text;
    const analysis = analyzeCommand(command);
    const argv = parseCommand(command).segments[0]?.argv ?? [];
    const isMcp = argv[0] === "claude" && argv[1] === "mcp" && argv[2] === "add";
    const mcp = isMcp ? mcpFromCommand(command) : null;
    const type: StepDraft["type"] = isMcp ? "mcp_add" : analysis.kind === "package_install" ? "cli_install" : "command";
    const title = isMcp
      ? `Register ${mcp?.name ?? "the"} MCP server`
      : analysis.installs.length
        ? `Install ${analysis.installs.join(", ")}`
        : `Run ${argv.slice(0, 3).join(" ")}`;
    const previous = steps.filter((s) => s.type !== "user_action").at(-1);
    steps.push({
      ...empty,
      id: slug(title, used),
      title,
      type,
      instruction: `Run: ${command}`,
      commands: [command],
      needsUser: false,
      risk: "low",
      confidence: 0.9,
      evidenceQuote: command,
      evidenceSource: fact.source,
      ...(isMcp && mcp ? { verifyRecipe: "claude-mcp-connected", verifyArgs: [{ key: "name", value: mcp.name }] } : verifyFor(command)),
      dependsOn: previous ? [previous.id] : [],
      mcp,
      explain: { whatItDoes: title + ".", whyNeeded: "Shown as part of the setup in the source.", whatChanges: analysis.reasons[0] ?? "See the command", howToUndo: "See the step details." },
    });
  }

  const runnable = steps.some((s) => s.type !== "user_action");
  const mcpStep = steps.find((s) => s.mcp);
  return {
    contentType: runnable ? "executable" : steps.length || facts.guideGate ? "needs_account" : "knowledge",
    summary: runnable
      ? `${steps.length} step${steps.length === 1 ? "" : "s"} to set up ${meta.title ?? "what this content shows"}.`
      : facts.guideGate
        ? "The creator shares the setup guide only on request."
        : "Nothing to set up here.",
    knowledge: [],
    usageHint: mcpStep?.mcp ? `Open Claude Code and ask it to use the ${mcpStep.mcp.name} tools for a small task.` : runnable ? "Try the tool once on something small." : null,
    guideRequired: facts.guideGate
      ? { keyword: facts.guideGate.keyword ?? null, instructions: `Comment "${facts.guideGate.keyword ?? "the keyword"}" on the post if you choose, then add the guide you receive.` }
      : null,
    steps: steps.slice(0, 20),
  };
}

