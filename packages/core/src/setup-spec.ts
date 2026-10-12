import { z } from "zod";

/**
 * The fixed contract between interpretation (LLM) and execution (agent).
 * Everything here is validated on the server when produced and again on the
 * device before anything runs. Bump SPEC_VERSION for breaking changes.
 */

export const SPEC_VERSION = 1 as const;

export const CONTENT_INTENTS = ["knowledge", "reference", "actionable", "executable", "requires_user"] as const;
export const ContentIntentSchema = z.enum(CONTENT_INTENTS);
export type ContentIntent = z.infer<typeof ContentIntentSchema>;

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const RiskSchema = z.enum(RISK_LEVELS);
export type Risk = z.infer<typeof RiskSchema>;

export const STEP_TYPES = ["cli_install", "mcp_add", "config_write", "file_create", "command", "user_action"] as const;
export const StepTypeSchema = z.enum(STEP_TYPES);
export type StepType = z.infer<typeof StepTypeSchema>;

export const EvidenceSchema = z.object({
  timestampSec: z.number().nonnegative().optional(),
  quote: z.string().max(500).optional(),
  // where the quote came from: screen | speech | document | caption | note | guide
  source: z.string().max(40).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

const JsonValue: z.ZodType<unknown> = z.json();

/** Structured file change. Executors never write free-form text produced outside this shape. */
export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("json_merge"), path: z.string().min(1).max(400), value: z.record(z.string(), JsonValue) }),
  z.object({ kind: z.literal("file_write"), path: z.string().min(1).max(400), content: z.string().max(64_000) }),
  // Idempotent: skipped when the exact line is already present (shell profiles, .gitignore, …).
  z.object({ kind: z.literal("append_line"), path: z.string().min(1).max(400), line: z.string().min(1).max(1000).regex(/^[^\n]*$/) }),
]);
export type Change = z.infer<typeof ChangeSchema>;

/** MCP registration as data, so the executor never has to parse a command string. */
export const McpServerSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/),
  transport: z.enum(["stdio", "http", "sse"]).default("stdio"),
  commandOrUrl: z.string().min(1).max(400),
  args: z.array(z.string().max(400)).max(30).default([]),
  scope: z.enum(["local", "user", "project"]).default("local"),
  /** env var NAMES the user must provide; values are never stored. */
  envKeys: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(20).default([]),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const ExplainSchema = z.object({
  whatItDoes: z.string().max(240),
  whyNeeded: z.string().max(240),
  whatChanges: z.string().max(240),
  howToUndo: z.string().max(240),
});
export type Explain = z.infer<typeof ExplainSchema>;

export const StepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "step ids are short slugs");

export const SetupStepSchema = z.object({
  id: StepIdSchema,
  title: z.string().min(1).max(120),
  type: StepTypeSchema,
  instruction: z.string().min(1).max(1200),
  commands: z.array(z.string().min(1).max(600)).max(10).default([]),
  target: z.string().max(400).optional(),
  needsUser: z.boolean(),
  risk: RiskSchema,
  confidence: z.number().min(0).max(1),
  evidence: EvidenceSchema.optional(),
  verify: z
    .object({ recipe: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/), args: z.record(z.string(), z.string().max(400)).default({}) })
    .optional(),
  dependsOn: z.array(StepIdSchema).max(10).default([]),
  change: ChangeSchema.optional(),
  mcp: McpServerSchema.optional(),
  /** Explicit version from the content, if any. Never guessed. */
  version: z.string().max(40).optional(),
  explain: ExplainSchema.optional(),
});
export type SetupStep = z.infer<typeof SetupStepSchema>;

export const SetupSpecSchema = z
  .object({
    specVersion: z.literal(SPEC_VERSION),
    source: z.object({
      itemId: z.string().min(1),
      platform: z.string().max(40),
      url: z.string().max(2048).optional(),
      creator: z.string().max(200).optional(),
      title: z.string().max(300).optional(),
    }),
    contentType: z.enum(["executable", "needs_account", "knowledge"]),
    summary: z.string().max(600),
    knowledge: z.array(z.string().max(300)).max(10).optional(),
    steps: z.array(SetupStepSchema).max(20),
    usageHint: z.string().max(300).optional(),
    suspiciousInstructions: z.array(z.string().max(500)).max(20).default([]),
    /** Comment/follow-gated guides ("comment MCP and I'll DM you the guide"). */
    guideRequired: z.object({ keyword: z.string().max(60).optional(), instructions: z.string().max(400) }).optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    spec.steps.forEach((step, i) => {
      if (ids.has(step.id)) ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: `duplicate step id ${step.id}` });
      ids.add(step.id);
    });
    spec.steps.forEach((step, i) => {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep) || dep === step.id) {
          ctx.addIssue({ code: "custom", path: ["steps", i, "dependsOn"], message: `unknown dependency ${dep}` });
        }
      }
      // A dependency must come earlier: keeps execution order a simple walk and rules out cycles.
      const position = new Map(spec.steps.map((s, j) => [s.id, j]));
      for (const dep of step.dependsOn) {
        if ((position.get(dep) ?? Infinity) >= i) {
          ctx.addIssue({ code: "custom", path: ["steps", i, "dependsOn"], message: `dependency ${dep} must precede ${step.id}` });
        }
      }
      if (step.type === "mcp_add" && !step.mcp && !step.needsUser) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "mcp"], message: "mcp_add steps need an mcp definition" });
      }
      if ((step.type === "config_write" || step.type === "file_create") && !step.change && !step.needsUser) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "change"], message: `${step.type} steps need a structured change` });
      }
    });
  });
export type SetupSpec = z.infer<typeof SetupSpecSchema>;

/** Stage 1 output: facts only, everything quoted from the content. */
export const ExtractedFactsSchema = z.object({
  title: z.string().max(300).optional(),
  creator: z.string().max(200).optional(),
  speech: z.array(z.object({ t: z.number().optional(), text: z.string().max(1000) })).max(50).default([]),
  screenText: z.array(z.object({ t: z.number().optional(), text: z.string().max(1000) })).max(50).default([]),
  toolsMentioned: z.array(z.string().max(80)).max(30).default([]),
  commands: z
    .array(z.object({ t: z.number().optional(), text: z.string().max(600), source: z.enum(["screen", "speech", "document"]) }))
    .max(30)
    .default([]),
  links: z.array(z.string().max(2048)).max(30).default([]),
  accountRequirements: z.array(z.string().max(200)).max(10).default([]),
  guideGate: z.object({ keyword: z.string().max(60).optional(), quote: z.string().max(300) }).optional(),
  suspiciousInstructions: z.array(z.string().max(500)).max(20).default([]),
});
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

/** What a dry run says will happen. Never produced by changing the system. */
export const PlannedActionSchema = z.object({
  stepId: z.string(),
  type: z.enum(["command", "file_create", "file_update", "package_install", "mcp_register", "user_action", "skip"]),
  description: z.string().max(400),
  command: z.string().max(600).optional(),
  path: z.string().max(400).optional(),
  diffPreview: z.string().max(8000).optional(),
  reversible: z.enum(["yes", "partial", "no"]),
});
export type PlannedAction = z.infer<typeof PlannedActionSchema>;

export const VerifyResultSchema = z.object({
  recipe: z.string(),
  ok: z.boolean(),
  detail: z.string().max(400),
  observed: z.string().max(200).optional(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export const StepOutcomeSchema = z.enum(["done", "skipped", "failed", "needs_user", "rolled_back"]);

export const StepResultSchema = z.object({
  stepId: z.string(),
  outcome: StepOutcomeSchema,
  summary: z.string().max(400),
  changedFiles: z.array(z.object({ path: z.string(), added: z.number().int(), removed: z.number().int() })).default([]),
  installed: z.array(z.string().max(120)).default([]),
  verify: VerifyResultSchema.optional(),
  snapshotIds: z.array(z.string()).default([]),
  reversible: z.enum(["yes", "partial", "no"]).default("no"),
  output: z.string().max(4000).optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;
