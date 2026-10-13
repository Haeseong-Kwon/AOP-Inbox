@AGENTS.md

# AOP Inbox — agent notes

Read `PROJECT_STATUS.md` first (state, limits, priorities) and `docs/adr/` before changing a stack decision.

- Commands: `pnpm dev` · `pnpm bootstrap` (deps + docker DB + migrate + seed) · `mise run check` (lint, typecheck, test) · `pnpm test:e2e` · `pnpm build`
- Schema change: edit `db/schema.ts` → `pnpm db:generate` → `pnpm db:migrate`. Never hand-edit applied migrations.
- Only `lib/ai/services.ts` may call an LLM. Prompts live in `lib/ai/prompts/`, schemas in `lib/ai/schemas.ts`.
- Saving anything goes through `lib/items/capture.ts`; background work through `lib/jobs/queue.ts` + `lib/ingestion/pipeline.ts`.
- Server-side fetches of user URLs must use `lib/security/safe-fetch.ts`.
- Never log note/message text. Never add Instagram scraping, private APIs, or credential handling.
- Cache Components is on: anything reading cookies/headers/params/pathname must sit under `<Suspense>`.
- Raw SQL inside `db.select({...})` subqueries: write `"items"."id"`, not `${items.id}` (Drizzle renders it unqualified).

## Action layer
- Read `docs/action-layer-architecture.md` and `docs/execution-security.md` before touching `packages/core`, `lib/actions`, `lib/execution` or `packages/agent`.
- Safety rules live in `packages/core` and run on BOTH server and device. Never add an execution path that bypasses `evaluateSpec` on the device.
- Risk only goes up: the LLM's label is a floor. New command/file rules need red-team cases in `tests/unit/core/*` and, ideally, a fixture in `evals/fixtures.json` (`pnpm eval`).
- Never test against the real `~/.claude`: use `packages/agent/test/helpers.ts#sandbox()` (temp HOME, fake `claude`).
- Execution status changes only via `transition()` in `lib/execution/jobs.ts`.
