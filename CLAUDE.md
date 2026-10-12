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
