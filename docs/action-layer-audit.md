# Action Layer — Phase 0 audit

_2026-10-12. Snapshot of the codebase before the Action Intelligence & Execution layer._

## Current state (verified)

| Area | Where | State |
|---|---|---|
| Repo | `main` = `origin/main` @ `a7e6de1`, clean tree, 6 commits | single package, pnpm 12, Node 24 (has global `WebSocket`, `node:sqlite`) |
| App | Next.js 16 App Router, Cache Components, route handlers under `app/api` | working, PPR shells |
| DB | Drizzle, one migration `0000_init.sql`, 14 tables; dev DB has 16 items | Postgres 17 + pgvector + pg_trgm |
| Auth | Better Auth, `withUser()` wrapper re-validates session + Origin check | single-owner allow-list |
| AI | `lib/ai/services.ts` (only LLM caller), `config.ts` (fast/strong profiles), `prompts/`, `schemas.ts` (Zod), `mock.ts` offline | structured output via AI SDK 7 |
| Capture | `lib/items/capture.ts`, `/api/capture`, share target, Meta import | working |
| Sources | `lib/sources/normalize.ts` adapter registry, `enrich.ts` behind SSRF guard | working |
| Jobs | `lib/jobs/queue.ts` Postgres queue (SKIP LOCKED, retries, `run_after`, idempotency keys) + `lib/ingestion/pipeline.ts` | working |
| Search/RAG | `lib/search/hybrid.ts`, `lib/search/ask.ts`, `/api/ask` NDJSON | working |
| UI | sidebar/mobile nav, Home, Inbox master–detail, `components/detail/item-detail.tsx`, ⌘K, settings | design system in `app/globals.css` tokens |
| Tests | Vitest unit + integration (test DB), Playwright smoke (desktop + mobile) | 68 + 7 passing |

## KEEP (unchanged)

Capture paths, source normalization/enrichment, SSRF guard, auth, Meta import, hybrid search core, collections, design tokens and existing screens, existing API routes, job queue implementation.

## EXTEND

- `itemAnalysisSchema` → add `contentIntent`, `actionability`, `executable`, `setupSpecCandidate`, `whatYouCanDo`, `guideRequired`. All optional on read; old rows have `content_intent = null` and are re-analyzed lazily (on open / "Check for actions"), never force-backfilled.
- `items` → additive columns (intent, actionability, action state, applied_at, parent_item_id for creator guides, action_text for search).
- Job queue → new job types (`extract_actions`, `follow_up`, `maintenance`) on the same table and runner.
- Ingestion pipeline → after `embed`, items whose intent is actionable/executable/requires_user get an `extract_actions` job.
- Search/Ask → include action text, setup state and execution history; Ask cites items `[n]` and executions `[En]` separately.
- `ai_usage` → provider, prompt version, estimated cost.
- Item detail → ACTION section (only when relevant); Inbox card → subtle action indicator; Home → Ready to apply / Waiting for you / Recently applied; Settings → Local Agent + notifications.

## REFACTOR (minimal)

- `pnpm-workspace.yaml` → add `packages/*` (root app stays the root; no monorepo rewrite).
- Shared contracts (SetupSpec, policy engine, state machine, protocol, redaction) go to `packages/core` so the server **and** the local agent enforce the same rules.

## New pieces

- `packages/core` — Zod contracts, shell-command analyzer, policy engine, path policy, state machine, failure codes, redaction, static planner.
- `packages/agent` — `aop-inbox` CLI (init/start/status/doctor/logs/undo/pause/resume/uninstall), Keychain token store, SQLite ledger, executors (Claude Code, shell argv, file, manual), verify recipes, snapshots, rollback. Zero runtime deps; bundled with esbuild.
- Server: `lib/actions` (extract → structure → validate → policy → persist SetupSpec), `lib/execution` (jobs, events ledger, devices, pairing, agent gateway), `lib/followups` (D+3/D+7, resurfacing, quiet hours), notifications.
- Gateway transport: agent opens outbound **SSE** stream (`GET /api/agent/stream`) for dispatch and POSTs events (`/api/agent/events`). Chosen over WebSocket because Next.js route handlers stream SSE natively on Node and it needs no extra server; the agent reconnects automatically.

## Out of scope (interfaces only)

Windows/Linux agent, Computer Use, Web Push delivery (in-app first, `Notifier` interface), Telegram, credential vault, recipe signing, high-risk execution.
