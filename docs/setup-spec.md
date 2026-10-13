# SetupSpec (specVersion 1)

The fixed contract between interpretation and execution. Defined with Zod in `packages/core/src/setup-spec.ts`; validated on the server when produced and **again on the device** before anything runs.

```ts
SetupSpec {
  specVersion: 1
  source: { itemId, platform, url?, creator?, title? }
  contentType: "executable" | "needs_account" | "knowledge"
  summary: string
  knowledge?: string[]
  steps: SetupStep[]                 // ≤ 20, dependsOn may only point to earlier steps (no cycles)
  usageHint?: string                 // used by the D+3 follow-up
  suspiciousInstructions: string[]   // from Stage 1; escalates linked steps to high
  guideRequired?: { keyword?, instructions }   // comment/follow-gated guides
}

SetupStep {
  id: slug; title; type: cli_install | mcp_add | config_write | file_create | command | user_action
  instruction; commands: string[]    // verbatim from extracted facts only
  target?                            // display only — executors never use it
  needsUser: boolean; risk: low|medium|high (a floor — policy can only raise it); confidence: 0–1
  evidence?: { quote, source, timestampSec }   // quote must exist in the facts
  verify?: { recipe, args }          // a catalog recipe (docs/verification-recipes.md)
  dependsOn: string[]
  change?: json_merge{path,value} | file_write{path,content} | append_line{path,line}   // structured writes only
  mcp?: { name, transport, commandOrUrl, args, scope, envKeys }   // MCP as data, never a parsed string
  version?                           // only when the content states one
  explain?: { whatItDoes, whyNeeded, whatChanges, howToUndo }
}
```

## How a spec is produced

1. **Stage 1 — extract** (`prompts/extract-facts.ts`, fast model): untrusted content wrapped as data → `ExtractedFacts` (commands with source, tools, links, account requirements, guide gate, suspicious instructions). Cached per canonical URL + content hash + prompt/schema version; the owner's note is extracted separately and never cached.
2. **Stage 2 — structure** (`prompts/structure-setup.ts`, strong model): facts only → flat draft (all-required, nullable fields so strict structured-output modes work everywhere).
3. **Evidence gate** (`lib/actions/postprocess.ts`): commands must equal a fact command (or one part of a `&&`/`;` chain); MCP definitions must match exactly one fact command field by field (scope, transport, argv, env keys); file-change payloads must appear in the facts; evidence quotes must be findable; secrets are redacted (and the step handed to the person); anything unbacked becomes `user_action` while keeping the **risk floor** of what was dropped.
4. **Validation** (`SetupSpecSchema`) and **policy preview**; stored as a new revision only when content/note/prompt versions changed.

## Versioning & reproducibility

`setup_specs`: `spec_version`, `revision`, `prompt_version`, `model`, `content_hash`. Every job stores the exact spec it ran plus `spec_revision`, agent version, executor version, OS and architecture.
