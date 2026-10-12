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

export type JobType = "process_item" | "assign_collections";
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
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms").notNull(),
  success: boolean("success").notNull(),
  createdAt: createdAt(),
});

export type Item = typeof items.$inferSelect;
export type Collection = typeof collections.$inferSelect;
