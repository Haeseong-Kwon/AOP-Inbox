# AOP Inbox

**Capture once. Understand automatically. Find anything later.**

AOP Inbox is an AI-native personal knowledge inbox. Save an Instagram Reel, a link, or a quick thought in a second; AOP Inbox summarizes it, explains why it matters, tags it, files it into collections and indexes it so you can find it weeks later by describing it — or ask questions answered only from what you saved.

It replaces the “share the Reel to myself in DMs and never see it again” habit.

```
Instagram → Share → AOP Inbox → Saved ✓
                       └─ normalize · dedupe · metadata · AI analysis · embedding · collections
```

---

## Features

| | |
|---|---|
| **Quick capture** | `C` or `⌘K` anywhere, paste, Enter. Links, Reels, or plain notes. Never waits on AI. |
| **Share target** | Installable PWA; on Android / desktop Chrome, share straight from Instagram to AOP Inbox. |
| **Instagram history import** | Upload Meta's “Download your information” export. Parsed **in your browser**; only links + dates reach the server. |
| **AI understanding** | Title, summary, key takeaways, action items, *why this matters*, category, tags, importance — as validated structured output. |
| **Smart collections** | Items are filed into a category → subcategory tree automatically. Add your own manual collections. |
| **Hybrid search** | Keyword (Postgres full text + trigram + tags) fused with semantic (pgvector) search, recency and importance. Results say *why* they matched. |
| **Ask Inbox** | RAG over your own items, streamed, with numbered citations linked to the source items. |
| **Related items** | Embedding neighbours under every item. |
| **Inbox workflow** | Unread / read / archived, favorites, actionable, notes, master–detail view, J/K keyboard navigation. |
| **Offline AI mode** | No API key? A deterministic local analyzer + hashed embeddings keep every feature working (lower quality). |

## Architecture

```
app/                 Next.js App Router — pages (app)/, API routes api/, login, onboarding, share target
components/          UI by surface: inbox/, detail/, capture/, command/, search/, ask/, collections/, import/, settings/, ui/ (shadcn)
lib/
  sources/           normalize.ts (pure, client+server) — URL canonicalization + SourceAdapter registry
                     enrich.ts — policy-safe metadata (oEmbed, HTML meta) behind the SSRF guard
  security/          safe-fetch.ts — SSRF-safe HTTP client (IP check at connect time, size/time/redirect limits)
  ai/                config.ts (provider + model profiles), services.ts (the only LLM caller),
                     prompts/, schemas.ts (Zod), mock.ts (offline analyzer)
  jobs/queue.ts      Postgres job queue: SKIP LOCKED claims, retries w/ backoff, idempotency keys, concurrency
  ingestion/         pipeline.ts — enrich → analyze → embed → collections, resumable per stage
  items/             capture.ts (single entry point for saving), repository.ts, types.ts (shared DTOs)
  search/            hybrid.ts (keyword + vector fusion, related), ask.ts (retrieval + context packing)
  import/            meta-export.ts (browser-side ZIP/JSON parsing), service.ts (preview / commit)
  auth/              Better Auth config, session helpers, AuthGate
db/                  schema.ts (Drizzle), migrations/, init/ (extensions for Docker)
scripts/             migrate.ts, seed.ts (+ seed-data.ts), worker.ts
tests/               unit/, integration/ (real Postgres), e2e/ (Playwright)
```

**Ingestion pipeline** — every stage persists its output and advances `items.processing_stage`, so retries resume where they stopped and a failure never loses the saved item:

```
POST /api/capture ─▶ normalize + dedupe ─▶ INSERT item (status: pending) ─▶ enqueue job ─▶ 201 (user is done)
                                                                               │  after() / worker / cron
                                                                               ▼
                       ENRICH (oEmbed / HTML meta, optional) ─▶ ANALYZE (LLM, cached by input hash)
                       ─▶ tags + AI collections ─▶ EMBED (cached by content hash) ─▶ completed
```

**Search** — `query → keyword candidates (tsvector + pg_trgm + tags) ∪ vector candidates (HNSW cosine) → score = 0.50·semantic + 0.35·keyword + 0.10·importance + 0.05·recency`.

**Ask Inbox** — `question → hybrid retrieval (top 8) → numbered context (notes outrank AI summaries) → strong model → NDJSON stream {sources, delta…}`.

## Stack

Next.js 16 (App Router, Cache Components, Turbopack) · React 19 · TypeScript strict · Tailwind CSS 4 · shadcn/ui (Radix) · lucide · motion · TanStack Query · PostgreSQL 17 + pgvector + pg_trgm · Drizzle ORM · Better Auth · Vercel AI SDK 7 (`@ai-sdk/openai-compatible`) · Zod 4 · fflate · Vitest · Playwright · pnpm · mise.

Decisions and trade-offs: [`docs/adr/0001-foundation-stack.md`](docs/adr/0001-foundation-stack.md).

## Local setup

Requirements: Node 24 (`mise install` or `.node-version`), pnpm 12, Docker.

```bash
cp .env.example .env.local      # then fill BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm bootstrap                  # install → docker compose up → migrate → seed demo data
pnpm dev                        # http://localhost:3000
```

In development the login form is prefilled with the seeded account (`DEV_USER_EMAIL` / `DEV_USER_PASSWORD`). That prefill only exists in `next dev`; production builds never contain it.

Common commands (also available as `mise run <task>`):

| Command | |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm db:up` | Start Postgres + pgvector (`127.0.0.1:54329`) |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations |
| `pnpm db:seed [-- --reset]` | Demo inbox for the dev user |
| `pnpm worker` | Long-running queue worker (self-hosting) |
| `pnpm reindex` | Re-embed items after changing the embedding model |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm build` | Quality gates |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres with `vector` + `pg_trgm` extensions |
| `TEST_DATABASE_URL` | tests | Separate DB used by `pnpm test` (created by `db/init`) |
| `BETTER_AUTH_SECRET` | ✓ | Session signing secret |
| `BETTER_AUTH_URL` | ✓ | Public base URL (`http://localhost:3000` locally) |
| `AUTH_ALLOWED_EMAILS` | ✓ | Comma-separated emails allowed to sign up. Empty = sign-up closed |
| `DEV_USER_EMAIL`, `DEV_USER_PASSWORD` | dev | Seeded account |
| `AI_PROVIDER` | | `openai` · `openrouter` · `local` · `mock` |
| `AI_API_KEY` | | Provider key. Empty (non-local) ⇒ offline mode |
| `AI_BASE_URL` | | Override endpoint (OpenAI-compatible) |
| `AI_MODEL` | | Cheap model for per-item analysis (default `gpt-4.1-mini`) |
| `AI_MODEL_STRONG` | | Ask Inbox synthesis (defaults to `AI_MODEL`) |
| `AI_EMBEDDING_MODEL` | | Must yield 1536 dims (default `text-embedding-3-small`) |
| `META_OEMBED_TOKEN` | | Meta app token for Instagram oEmbed previews. Without it Instagram items are URL-only |
| `CRON_SECRET` | prod | Bearer token for `GET/POST /api/jobs/run` from a scheduler |

## AI provider setup

All model calls go through `lib/ai/services.ts`; switching vendors is configuration:

```bash
# OpenAI
AI_PROVIDER=openai      AI_API_KEY=sk-...   AI_MODEL=gpt-4.1-mini  AI_MODEL_STRONG=gpt-4.1
# OpenRouter
AI_PROVIDER=openrouter  AI_API_KEY=sk-or-... AI_MODEL=openai/gpt-4.1-mini  AI_EMBEDDING_MODEL=openai/text-embedding-3-small
# Local (Ollama / LM Studio / vLLM — OpenAI-compatible)
AI_PROVIDER=local       AI_BASE_URL=http://localhost:11434/v1  AI_MODEL=qwen3:8b  AI_EMBEDDING_MODEL=<1536-dim model>
```

Embeddings are stored with their model name and a knowledge-document version. Changing `AI_EMBEDDING_MODEL` (or bumping `KNOWLEDGE_DOC_VERSION`) makes items eligible for re-indexing — run `pnpm reindex`. Per-call model, latency and token usage are logged to `ai_usage`.

## Importing Instagram history

1. Instagram → **Accounts Center → Your information and permissions → Download your information**.
2. Select **Messages**, format **JSON**, request the download.
3. In AOP Inbox open **Import** (Settings, ⌘K, or onboarding) and drop the `.zip`.

The archive is unpacked in the browser (`fflate`); text files are scanned recursively for `instagram.com/reel|p|tv` and other URLs — no fixed export schema is assumed. You get a preview (Reels / posts / other links / duplicates / new) and confirm. Only `{url, timestamp}` pairs are sent; message text is never uploaded or stored. Items are dated by when you originally shared them and analyzed in the background.

## PWA & mobile capture

- Install from the browser (Settings → Capture shows how per platform).
- **Android / desktop Chrome**: Instagram → Share → *AOP Inbox* → “Saved ✓” (Web Share Target, `GET /share`).
- **iPhone**: iOS does not support Web Share Target for PWAs. Copy the Reel link, open AOP Inbox, tap **+** → **Paste**.
- `POST /api/capture` is the stable capture API for a future native or Expo wrapper.

## Testing

```bash
pnpm test         # Vitest: unit (normalization, SSRF guard, Meta export parsing, AI schemas, redirects)
                  #         integration against TEST_DATABASE_URL (capture, dedupe, pipeline, queue retries, search, import)
pnpm test:e2e     # Playwright smoke on desktop + Pixel 7 (needs `pnpm bootstrap`; reuses a running dev server)
```

## Security & privacy

- No Instagram credentials, cookies, private APIs, DM crawling or scraping — ever. Instagram metadata only via official oEmbed when a token is configured.
- Meta exports are parsed client-side; only links and dates leave the device; logs never contain message or note text.
- Server-side fetching of user URLs goes through an SSRF guard that validates the resolved IP at connect time (private/link-local/metadata ranges, IPv6-mapped forms), restricts ports, caps size, time and redirects.
- Auth: Better Auth email/password, httpOnly cookies, sign-up limited to `AUTH_ALLOWED_EMAILS`, rate-limited. Every API route re-validates the session; the proxy is only an optimistic redirect. Cross-site writes are rejected by an Origin check.
- The share target only auto-saves on genuine OS share navigations (`Sec-Fetch-Site: none`); anything else asks first.
- Secrets live in `.env.local` (git-ignored). `.env.example` contains no values.

## Roadmap

- YouTube transcripts and TikTok/X adapters with richer enrichment
- Browser extension and an Expo share-extension wrapper (iOS share sheet)
- AI-maintained collection hierarchy merging/renaming
- Model routing per task, batch analysis for large imports
- Weekly “resurface” digest of unread high-value items
- Knowledge graph view of related items
