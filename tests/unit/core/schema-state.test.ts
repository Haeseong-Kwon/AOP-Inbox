import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, redactSecrets, SetupSpecSchema, validateRecipeArgs } from "@aop-inbox/core";
import { spec, step } from "./fixtures";

describe("SetupSpec schema", () => {
  it("accepts a valid spec", () => {
    expect(SetupSpecSchema.safeParse(spec([step({ id: "a" }), step({ id: "b", dependsOn: ["a"] })])).success).toBe(true);
  });
  it.each([
    ["unknown dependency", spec([step({ id: "a", dependsOn: ["zzz"] })])],
    ["dependency after the step", spec([step({ id: "a", dependsOn: ["b"] }), step({ id: "b" })])],
    ["self dependency", spec([step({ id: "a", dependsOn: ["a"] })])],
    ["duplicate ids", spec([step({ id: "a" }), step({ id: "a" })])],
    ["invalid risk", spec([{ ...step({ id: "a" }), risk: "extreme" as never }])],
    ["confidence above 1", spec([step({ id: "a", confidence: 1.2 })])],
    ["wrong spec version", { ...spec([]), specVersion: 2 as never }],
    ["mcp step without definition", spec([step({ id: "a", type: "mcp_add" })])],
    ["config step without change", spec([step({ id: "a", type: "config_write" })])],
  ])("rejects %s", (_name, value) => {
    expect(SetupSpecSchema.safeParse(value).success).toBe(false);
  });
});

describe("execution state machine", () => {
  it("allows the happy path and undo", () => {
    for (const [a, b] of [
      ["planning", "awaiting_approval"],
      ["awaiting_approval", "queued"],
      ["queued", "executing"],
      ["executing", "verifying"],
      ["verifying", "done"],
      ["done", "rolling_back"],
      ["rolling_back", "rolled_back"],
    ] as const) expect(canTransition(a, b)).toBe(true);
  });
  it.each([
    ["planning", "executing"],
    ["awaiting_approval", "executing"],
    ["done", "executing"],
    ["cancelled", "queued"],
    ["failed", "done"],
    ["expired", "queued"],
  ] as const)("blocks %s → %s", (a, b) => {
    expect(() => assertTransition(a, b)).toThrow();
  });
});

describe("redaction", () => {
  it.each([
    "export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
    "Authorization: Bearer abc.def.ghijklmnopqrstuv",
    "token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "password=hunter2hunter2",
  ])("redacts %s", (text) => {
    const out = redactSecrets(text);
    expect(out).toContain("[redacted]");
    expect(out).not.toMatch(/sk-proj-abc|ghp_aaaa|hunter2|ghijklmnop/);
  });
});

describe("recipe args", () => {
  it("rejects unknown recipes and unsafe args", () => {
    expect(validateRecipeArgs("rm-everything", {}).ok).toBe(false);
    expect(validateRecipeArgs("http-healthcheck", { url: "https://evil.com" }).ok).toBe(false);
    expect(validateRecipeArgs("command-exists", { command: "node; rm -rf /" }).ok).toBe(false);
    expect(validateRecipeArgs("claude-mcp-connected", { name: "notion" }).ok).toBe(true);
  });
});
