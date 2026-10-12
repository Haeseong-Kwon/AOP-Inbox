import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { ContentIntent, ExecutionStatus, ItemActionState, PlannedAction, SetupSpec, SpecPolicy, StepResult } from "@aop-inbox/core";

export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ─── Auth (Better Auth core tables) ───────────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ─── Knowledge items ──────────────────────────────────────────────────── */

export type SourceType =
  | "instagram"
  | "youtube"
  | "tiktok"
  | "x"
  | "threads"
  | "web"
  | "github"
  | "pdf"
  | "note";
export type ItemStatus = "unread" | "read" | "archived";
export type ProcessingStatus = "pending" | "processing" | "completed" | "failed";
export type ProcessingStage = "enrich" | "analyze" | "embed" | "done";

// Everything keyword search should see. Tags are matched separately via item_tags.
const searchTextExpr: SQL = sql`
  coalesce(ai_title, '') || ' ' || coalesce(original_title, '') || ' ' ||
  coalesce(summary, '') || ' ' || coalesce(description, '') || ' ' ||
  coalesce(why_it_matters, '') || ' ' || coalesce(user_note, '') || ' ' ||
  coalesce(category, '') || ' ' || coalesce(creator_name, '') || ' ' ||
  coalesce(canonical_url, '')`;

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    sourceType: text("source_type").$type<SourceType>().notNull(),
    sourceUrl: text("source_url"),
    canonicalUrl: text("canonical_url"),
    externalId: text("external_id"),
    // instagram: reel | post | tv — web: article | page …
    contentKind: text("content_kind"),

    originalTitle: text("original_title"),
    aiTitle: text("ai_title"),
    description: text("description"),
    // Extracted body text / transcript. Truncated; never raw DM content.
    contentText: text("content_text"),
    summary: text("summary"),
    whyItMatters: text("why_it_matters"),
    keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
    actionItems: jsonb("action_items").$type<string[]>().notNull().default([]),
    category: text("category"),
    language: text("language"),
    userNote: text("user_note"),

    creatorName: text("creator_name"),
    creatorUrl: text("creator_url"),
    siteName: text("site_name"),
    thumbnailUrl: text("thumbnail_url"),

    status: text("status").$type<ItemStatus>().notNull().default("unread"),
    favorite: boolean("favorite").notNull().default(false),
    actionable: boolean("actionable").notNull().default(false),
    importanceScore: real("importance_score"),

    processingStatus: text("processing_status").$type<ProcessingStatus>().notNull().default("pending"),
    processingStage: text("processing_stage").$type<ProcessingStage>().notNull().default("enrich"),
    processingError: text("processing_error"),
    // sha256 of the analysis input; identical input skips the LLM call.
    analysisHash: text("analysis_hash"),
    analysisModel: text("analysis_model"),

    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),

    // Action layer (all nullable: rows analyzed before it existed are re-analyzed lazily)
    contentIntent: text("content_intent").$type<ContentIntent>(),
    actionabilityScore: real("actionability_score"),
    actionabilityReason: text("actionability_reason"),
    whatYouCanDo: text("what_you_can_do"),
    actionState: text("action_state").$type<ItemActionState>(),
    /** Searchable digest of the setup spec + execution history (maintained by lib/actions/state.ts). */
    actionText: text("action_text"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** Creator guide attached to a Reel: the guide item points at its parent. */
    parentItemId: uuid("parent_item_id").references((): AnyPgColumn => items.id, { onDelete: "set null" }),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),

    searchText: text("search_text").generatedAlwaysAs(searchTextExpr),
    searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('simple', ${searchTextExpr})`),
  },
  (t) => [
    uniqueIndex("items_user_canonical_uq")
      .on(t.userId, t.canonicalUrl)
      .where(sql`${t.canonicalUrl} is not null`),
    index("items_user_saved_idx").on(t.userId, t.savedAt.desc()),
    index("items_user_status_idx").on(t.userId, t.status),
    index("items_search_vector_idx").using("gin", t.searchVector),
    index("items_search_trgm_idx").using("gin", sql`${t.searchText} gin_trgm_ops`),
    index("items_user_action_state_idx").on(t.userId, t.actionState),
    index("items_parent_idx").on(t.parentItemId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_user_slug_uq").on(t.userId, t.slug)],
);

export const itemTags = pgTable(
  "item_tags",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index("item_tags_tag_idx").on(t.tagId)],
);

export type CollectionKind = "manual" | "smart" | "ai";

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => collections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    kind: text("kind").$type<CollectionKind>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("collections_user_slug_uq").on(t.userId, t.slug)],
);

export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    addedBy: text("added_by").$type<"user" | "ai">().notNull().default("ai"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.itemId] }), index("collection_items_item_idx").on(t.itemId)],
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    // Bump KNOWLEDGE_DOC_VERSION in lib/ai/embeddings.ts to force a re-index.
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("embeddings_item_model_uq").on(t.itemId, t.model),
    index("embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* ─── Jobs, imports, observability ─────────────────────────────────────── */

export type JobType = "process_item" | "assign_collections" | "extract_actions" | "follow_up" | "maintenance";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<JobType>().notNull(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    // One live job per key; re-enqueueing the same work is a no-op.
    idempotencyKey: text("idempotency_key").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAfter),
  ],
);

export type ImportStats = {
  totalLinks: number;
  instagramReels: number;
  instagramPosts: number;
  otherLinks: number;
  duplicates: number;
  created: number;
};

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  source: text("source").$type<"meta_export">().notNull(),
  status: text("status").$type<"completed" | "failed">().notNull(),
  stats: jsonb("stats").$type<ImportStats>().notNull(),
  createdAt: createdAt(),
});

export const searchHistory = pgTable(
  "search_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"search" | "ask">().notNull(),
    query: text("query").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("search_history_user_idx").on(t.userId, t.createdAt.desc())],
);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id"),
  operation: text("operation").notNull(),
  provider: text("provider"),
  model: text("model").notNull(),
  promptVersion: integer("prompt_version"),
  estimatedCostUsd: real("estimated_cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms").notNull(),
  success: boolean("success").notNull(),
  createdAt: createdAt(),
});

/* ─── Action layer ─────────────────────────────────────────────────────── */

export const setupSpecs = pgTable(
  "setup_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    specVersion: integer("spec_version").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    model: text("model").notNull(),
    spec: jsonb("spec").$type<SetupSpec>().notNull(),
    /** Server-side (lexical) policy preview at creation time; the device re-evaluates before running. */
    policy: jsonb("policy").$type<SpecPolicy>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("setup_specs_item_revision_uq").on(t.itemId, t.revision), index("setup_specs_user_idx").on(t.userId)],
);

/** Stage-1 fact extraction cache, keyed by content only (no user notes). */
export const actionAnalysisCache = pgTable("action_analysis_cache", {
  cacheKey: text("cache_key").primaryKey(),
  facts: jsonb("facts").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    arch: text("arch").notNull(),
    osVersion: text("os_version"),
    agentVersion: text("agent_version"),
    executorVersion: text("executor_version"),
    /** sha256 of the device token; the token itself is only on the device (Keychain). */
    tokenHash: text("token_hash").notNull(),
    paused: boolean("paused").notNull().default(false),
    autoRunLow: boolean("auto_run_low").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("devices_token_hash_uq").on(t.tokenHash), index("devices_user_idx").on(t.userId)],
);

export const devicePairings = pgTable("device_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
});

/** Fixed-window counters for unauthenticated endpoints (pairing). Shared across instances. */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const executionJobs = pgTable(
  "execution_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The ledger outlives the item; the title is kept so history stays readable.
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    itemTitle: text("item_title").notNull(),
    setupSpecId: uuid("setup_spec_id").references(() => setupSpecs.id, { onDelete: "set null" }),
    specRevision: integer("spec_revision").notNull(),
    /** Exact spec this job runs — reproducible even if the item is re-analyzed. */
    spec: jsonb("spec").$type<SetupSpec>().notNull(),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    status: text("status").$type<ExecutionStatus>().notNull(),
    risk: text("risk").$type<"low" | "medium" | "high">().notNull(),
    approvedStepIds: jsonb("approved_step_ids").$type<string[]>().notNull().default([]),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    plan: jsonb("plan").$type<PlannedAction[]>(),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    agentVersion: text("agent_version"),
    executorVersion: text("executor_version"),
    os: text("os"),
    arch: text("arch"),
    /** Bumped on every dispatch so a stale stream never re-sends a handled job. */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("execution_jobs_user_idx").on(t.userId, t.createdAt.desc()),
    index("execution_jobs_item_idx").on(t.itemId),
    index("execution_jobs_device_status_idx").on(t.deviceId, t.status),
  ],
);

export type StepStatus = "pending" | "done" | "skipped" | "failed" | "needs_user" | "rolled_back";

export const executionSteps = pgTable(
  "execution_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => executionJobs.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<StepStatus>().notNull().default("pending"),
    /** includes verification result, changed files, snapshot ids */
    result: jsonb("result").$type<StepResult>(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("execution_steps_job_step_uq").on(t.jobId, t.stepId)],
);

/** Append-only execution ledger. Never updated or deleted by the app. */
export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => executionJobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"follow_up_d3" | "follow_up_d7" | "resurface" | "approval_required" | "execution_result" | "user_action">().notNull(),
    title: text("title").notNull(),
    body: text("body"),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => executionJobs.id, { onDelete: "cascade" }),
    /** One live notification per key (e.g. follow-up:d3:<jobId>). */
    dedupeKey: text("dedupe_key").notNull(),
    deliverAfter: timestamp("deliver_after", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey), index("notifications_user_idx").on(t.userId, t.deliverAfter)],
);

export type UsageFeedbackKind = "used" | "useful" | "not_using" | "rolled_back" | "remind_later" | "applied";

export const usageFeedback = pgTable(
  "usage_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => executionJobs.id, { onDelete: "set null" }),
    kind: text("kind").$type<UsageFeedbackKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_feedback_item_idx").on(t.itemId)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  quietStart: integer("quiet_start").notNull().default(22),
  quietEnd: integer("quiet_end").notNull().default(8),
  followUps: boolean("follow_ups").notNull().default(true),
  /** Global kill switch: nothing executes on any device while true. */
  executionPaused: boolean("execution_paused").notNull().default(false),
  updatedAt: updatedAt(),
});

/** Privacy-friendly product analytics: names + ids only, never content. */
export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    itemId: uuid("item_id"),
    props: jsonb("props").$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("product_events_user_name_idx").on(t.userId, t.name, t.createdAt)],
);

export type Item = typeof items.$inferSelect;
export type ExecutionJob = typeof executionJobs.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Collection = typeof collections.$inferSelect;
