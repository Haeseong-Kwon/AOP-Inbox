# ADR 0001 — Foundation stack and service boundaries

- Status: accepted
- Date: 2026-10-12

## Context

AOP Inbox is a single-user knowledge inbox today that should be able to become multi-user later. It must run locally with one command, avoid vendor lock-in for AI and auth, respect Meta/Instagram policy, and stay small enough for one person to maintain.

## Decisions

| Area | Choice | Why | Revisit when |
|---|---|---|---|
| Framework | Next.js 16 App Router, Cache Components on | One deployable for UI + API; PPR gives instant static shells while data streams in | — |
| Data | PostgreSQL 17 + pgvector + pg_trgm, Drizzle ORM | One store for relational data, full text, trigram and vectors; transactional embeddings | >1M items or multi-tenant vector load → dedicated vector store |
| Auth | Better Auth (self-hosted, Drizzle adapter), email/password, allow-listed sign-up | No external IdP dependency; tables live in our DB; OAuth/passkeys are plugins away | Opening sign-ups to the public |
| AI | Vercel AI SDK 7 via `@ai-sdk/openai-compatible`; all calls in `lib/ai/services.ts` | OpenAI, OpenRouter and local servers speak the same protocol; config-only switching; Zod-validated structured output | A provider-specific feature becomes essential |
| Model profiles | `fast` (per-item analysis) / `strong` (Ask Inbox) | Cost control; routing seam for later | Per-task routing needs more than two tiers |
| Embedding size | Fixed 1536 dims, model + doc version stored per row | Single HNSW index; re-index path exists | Adopting a model that can't produce 1536 dims (migration + reindex) |
| Background work | Postgres job table (SKIP LOCKED, backoff, idempotency keys), drained by `after()`, a worker script, or cron | No Redis to run; good to thousands of jobs/hour | Sustained throughput or fan-out needs → BullMQ / cloud queue behind `enqueue`/`runJobs` |
| Client data | TanStack Query against JSON route handlers | The same API serves the web app and future native capture; easy polling and optimistic updates | — |
| Instagram | Share target + paste + Meta export import; oEmbed only with an app token | Zero policy risk: no scraping, no private APIs, no credentials | Meta offers an official saved-content API |
| Meta export parsing | In the browser | Private messages never leave the device; no upload limits, no zip-slip, no temp files | Need for server-side bulk/background parsing |
| Offline AI | Deterministic mock analyzer + hashed embeddings when no key is set | App and tests fully work without network or spend | — |

## Consequences

- Swapping a queue, AI vendor or auth provider is contained to one module each.
- The 1536-dim column is a deliberate constraint; changing it is a migration plus `pnpm reindex`.
- Offline mode quality is clearly lower and is labelled as such in the UI.
