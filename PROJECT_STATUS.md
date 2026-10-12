# PROJECT_STATUS — AOP Inbox

_Last updated: 2026-10-12. Written for the next engineer or agent picking this up._

## What exists

A working, single-user, production-shaped MVP: Next.js 16 app + Postgres/pgvector + Better Auth + an AI pipeline with an offline fallback. Everything in the MVP checklist of the original brief is implemented; see “Not done / limits” for the honest gaps.

## Architecture (one screen)

- **Capture** → `lib/items/capture.ts` (normalize via `lib/sources/normalize.ts`, dedupe on `(user_id, canonical_url)` unique index, note-append on duplicate) → insert → enqueue `process_item`.
- **Jobs** → `lib/jobs/queue.ts` (Postgres, SKIP LOCKED, 3 attempts, 15s·2ⁿ backoff, idempotency keys, concurrency 3). Drained by `after()` in API routes, `POST /api/jobs/run` (session or `CRON_SECRET`), the client “queue nudge” while items are pending, or `pnpm worker`.
- **Pipeline** → `lib/ingestion/pipeline.ts`: `enrich` (optional, failures degrade) → `analyze` (skipped if input hash unchanged) → tags + AI collections → `embed` (skipped if content hash unchanged). Final failure sets `processing_status=failed` with a friendly message; the item is never lost.
- **AI** → `lib/ai/services.ts` only. Providers: openai / openrouter / local (OpenAI-compatible) / mock. Profiles: `AI_MODEL` (fast), `AI_MODEL_STRONG` (Ask). Usage rows in `ai_usage`.
- **Search** → `lib/search/hybrid.ts`: tsvector(simple) + pg_trgm + tag match ∪ pgvector HNSW cosine; weighted fusion + reasons. **Ask** → `lib/search/ask.ts` + `/api/ask` NDJSON stream with numbered citations.
- **UI** → client components on TanStack Query over JSON route handlers; pages are PPR shells (Cache Components). Inbox state lives in the URL (`?source=&state=&sort=&collection=&tag=&item=`).

## Run it

```bash
cp .env.example .env.local   # set BETTER_AUTH_SECRET; AI_API_KEY optional
pnpm bootstrap               # deps, docker Postgres (127.0.0.1:54329), migrations, seed
pnpm dev                     # login form is prefilled with the dev user in development
```

## Environment

See README “Environment variables”. Minimum: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ALLOWED_EMAILS`. Without `AI_API_KEY` the app runs in offline AI mode (heuristic summaries, hashed embeddings, extractive Ask answers).

## Database / migrations

- `db/migrations/0000_init.sql` — all tables, extensions (`vector`, `pg_trgm`), generated `search_text`/`search_vector`, GIN + trigram + HNSW indexes. Applied locally and on the test DB.
- Tables: `user, session, account, verification` (Better Auth) · `items, tags, item_tags, collections, collection_items, embeddings` · `processing_jobs, imports, search_history, ai_usage`.
- Intentionally **not** created from the brief's list: `sources` (source adapters are code; `items.source_type` suffices), `notes` (one note per item → `items.user_note`), `import_items` (`items.import_id` links rows to an import). Add them if a real need appears.

## AI integration status

- Structured analysis (`itemAnalysisSchema`): title, summary, category (fixed taxonomy of 10), subcategory (reuses existing ones), tags, key points, action items, why it matters, importance 0–1, language.
- Verified end to end in **offline mode** only. The OpenAI-compatible path is implemented against AI SDK 7 docs and typechecks, but has **not been exercised against a live key** in this session — first thing to do once a key is set (capture one item, check `ai_usage`, try Ask).
- Embeddings: 1536 dims; `pnpm reindex` after changing `AI_EMBEDDING_MODEL`.

## Done

Auth (Better Auth, allow-listed sign-up, rate limits) · onboarding (3 steps) · Home · Inbox (cards/compact, filters, sorts, infinite scroll, master–detail, J/K/Enter/E/F/A/U/O/Esc) · item detail (summary, why it matters, takeaways, actions, note editor, tags, collections, extracted text, related) · quick capture (⌘K, C, paste button, source detection, note on Tab) · notes · Instagram/YouTube/web/known-host detection · URL normalization & tracking removal · duplicate detection (“Already in your Inbox”, note appended) · AI summary/tags/classification/key points/why/importance · Postgres + pgvector · keyword, semantic, hybrid search with match reasons · smart collections (AI tree) + manual collections · related items · favorites / unread / read / archive / actionable · Ask Inbox RAG with citations · Meta export import (client-side parsing, preview, dedupe, bulk insert, background analysis) · PWA (manifest, icons, share target, SW with offline page) · command palette · responsive (390/768/1440 checked) · dark/light/system theme · loading/empty/error states · tests · README · this file.

## Tests

- `pnpm test`: 68 Vitest tests — unit (normalization, SSRF guard, Meta export parsing, AI schemas/config, redirect safety) and integration on `aop_inbox_test` (capture, dedupe, pipeline, analysis caching, queue retries/idempotency, item state, tenant isolation, hybrid search incl. Korean, related, import preview/commit).
- `pnpm test:e2e`: Playwright smoke on desktop + Pixel 7 (capture → inbox → detail → search, duplicate capture, signed-out redirect/401). Runs against the dev server + dev DB and cleans up after itself.
- `tests/e2e/qa-shots.mjs`, `qa-interactions.mjs`: screenshot helpers used for design QA (not part of CI).

## Not done / known limits

- **Live LLM path untested** (see above). Prompts may need tuning on real output.
- **iOS share sheet**: Web Share Target is not supported by iOS PWAs; iPhone users paste links. Needs a native/Expo share extension (the capture API is ready).
- **Instagram metadata**: without `META_OEMBED_TOKEN`, Reels have no title/thumbnail until AI analysis — and the AI only sees the URL + your note, so cards for un-noted Reels are thin by design (no scraping). Adding a short note on capture improves them a lot.
- No transcripts (video content isn't downloaded — policy). YouTube gets oEmbed metadata only.
- Inbox list is paginated (40/page, offset) but not virtualized; fine to ~10k items, revisit beyond.
- Ask Inbox is single-turn per question (no follow-up memory).
- Manual collections can be created/assigned but not renamed/deleted from the UI yet.
- No CSP header yet (other security headers are set). Add a nonce-based CSP before public deployment.
- `/api/jobs/run` from the client nudge runs ≤20s per call; very large imports finish faster with `pnpm worker` or a cron hitting the endpoint with `CRON_SECRET`.
- Rate limiting covers auth endpoints (Better Auth); app API routes rely on auth + single-user scope.

## Meta / Instagram constraints (by design)

No Instagram credentials, cookies, private endpoints, DM crawling, automated browsers or media downloads. Collection paths are: share target / paste (new items) and Meta's official “Download your information” export (history). Export parsing happens in the browser and only `{url, timestamp}` is sent; message bodies are never stored or logged.

## Next priorities

1. Run with a real `AI_API_KEY`; tune `lib/ai/prompts/analyze-item.ts` on 20–30 real Reels/articles; check cost in `ai_usage`.
2. Deploy (Vercel or a container + managed Postgres with pgvector), set `BETTER_AUTH_URL`, `CRON_SECRET` + a 1-minute cron on `/api/jobs/run`, add CSP.
3. iOS capture: Expo/native share extension posting to `/api/capture` (add token auth for non-cookie clients).
4. Collection management (rename/merge/delete; AI-suggested merges of near-duplicate subcategories).
5. Resurfacing: weekly digest of unread high-value items; “continue where you left off” across devices.
