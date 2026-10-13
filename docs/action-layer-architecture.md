# Action layer — architecture

AOP Inbox turns saved content into **knowledge** (summary, tags, search, Ask) and — when the content shows something you can actually do — into an **action**: a reviewed, verified, undoable setup on your Mac.

```
CAPTURE → UNDERSTAND (analysis + intent) ─┬─ knowledge / reference ─▶ summary · tags · search · Ask · related
                                          └─ actionable / executable / requires_user
                                               │
                         Stage 1  extract facts (untrusted content → quotes only)      lib/ai/services.extractFacts
                         Stage 2  structure (facts only → plan draft)                  lib/ai/services.structureSetup
                                  evidence gate + secret redaction                     lib/actions/postprocess.ts
                                  SetupSpec (Zod, versioned, revisioned)               packages/core/setup-spec.ts
                                  policy (deterministic)                                packages/core/policy.ts
                                               │
                         Review (web) ── Run ──▶ job: planning ─▶ device dry run ─▶ awaiting_approval ─▶ queued
                                               │                                         (medium: always)
                         Local Agent (Mac): re-validate · re-run policy on real FS · enforce approvals
                                            snapshot ─▶ execute (argv only) ─▶ verify ─▶ record
                                            failure ─▶ automatic rollback      Undo ─▶ rollback
                                               │
                         Ledger (job_events, append-only) · Activity · Applied · D+3 / D+7 follow-ups
```

## Where things live

| Concern | Module |
|---|---|
| Contracts (SetupSpec, ExtractedFacts, PlannedAction, StepResult, protocol) | `packages/core/src/setup-spec.ts`, `protocol.ts` |
| Command analysis (tokenizer, risk) | `packages/core/src/command.ts` |
| File-change risk (content-aware) | `packages/core/src/changes.ts` |
| Path zones (realpath, symlinks, traversal) | `packages/core/src/paths.ts` |
| Policy engine | `packages/core/src/policy.ts` |
| State machine, failure codes, redaction | `packages/core/src/state.ts`, `errors.ts`, `redact.ts` |
| Extraction pipeline, evidence gate | `lib/actions/pipeline.ts`, `postprocess.ts`, `llm-schemas.ts`, `mock-actions.ts` |
| Item action state + searchable digest | `lib/actions/state.ts` |
| Jobs, transitions, ledger, approvals | `lib/execution/jobs.ts` |
| Device pairing/auth, gateway (SSE + events) | `lib/execution/devices.ts`, `gateway.ts`, `app/api/agent/*` |
| Follow-ups, maintenance, notifications | `lib/followups`, `lib/notify` |
| Local agent | `packages/agent` (see `docs/local-agent.md`) |
| UI | `components/actions/*`, `components/activity/*`, `components/settings/agent-settings.tsx` |

## Data

`setup_specs` (item → revisions, with spec, policy preview, prompt version, model) → `execution_jobs` (exact spec snapshot, device, status, approvals, plan, agent/executor/OS versions) → `execution_steps` (per-step result incl. verification, changed files, snapshot ids) → `job_events` (append-only ledger). Plus `devices`, `device_pairings`, `notifications`, `usage_feedback`, `user_preferences`, `product_events`, `action_analysis_cache`. Item columns: `content_intent`, `actionability_*`, `what_you_can_do`, `action_state`, `action_text`, `applied_at`, `parent_item_id` (creator guides).

Merged tables (vs. the original list): snapshots and verification results are recorded in `execution_steps.result` + `job_events` on the server and in the agent's SQLite ledger (the snapshot files never leave the Mac).

## Knowledge stays first-class

Analysis classifies intent; only actionable intents pay for extraction. Knowledge items never show an action block. Search and Ask read the action digest and execution history, so "the Notion MCP reel I installed" finds the item, the run date and its result.

## Transport

The agent connects out: `GET /api/agent/stream` (SSE, re-reads the device row every tick, 4-minute streams, auto-reconnect) and `POST /api/agent/events`. Dispatch is idempotent (`dispatched_at`, cleared on `agent.hello`). One active execution per device.
