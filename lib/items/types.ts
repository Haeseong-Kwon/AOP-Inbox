import { z } from "zod";
import type { ItemStatus, ProcessingStatus, SourceType } from "@/db/schema";

/** Shapes shared by API routes and client components. No server imports here. */

export interface ItemSummary {
  id: string;
  sourceType: SourceType;
  contentKind: string | null;
  title: string;
  summary: string | null;
  thumbnailUrl: string | null;
  creatorName: string | null;
  domain: string | null;
  sourceUrl: string | null;
  status: ItemStatus;
  favorite: boolean;
  actionable: boolean;
  importanceScore: number | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  savedAt: string;
  tags: string[];
  collection: string | null;
}

export interface ItemDetail extends ItemSummary {
  canonicalUrl: string | null;
  originalTitle: string | null;
  description: string | null;
  contentText: string | null;
  whyItMatters: string | null;
  keyPoints: string[];
  actionItems: string[];
  category: string | null;
  userNote: string | null;
  creatorUrl: string | null;
  publishedAt: string | null;
  lastViewedAt: string | null;
  collections: { id: string; name: string; kind: string }[];
}

export const ITEM_STATES = ["unread", "read", "favorite", "actionable", "archived", "high-value"] as const;
export const ITEM_SORTS = ["recent", "oldest", "importance", "viewed"] as const;
export const SOURCE_FILTERS = ["instagram", "web", "note", "youtube"] as const;

export const listQuerySchema = z.object({
  source: z.enum(SOURCE_FILTERS).optional(),
  state: z.enum(ITEM_STATES).optional(),
  sort: z.enum(ITEM_SORTS).default("recent"),
  collection: z.uuid().optional(),
  tag: z.string().max(80).optional(),
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface ItemPage {
  items: ItemSummary[];
  nextCursor: number | null;
}

export const captureSchema = z.object({
  input: z.string().trim().min(1, "Paste a link or write something").max(20_000),
  note: z.string().trim().max(10_000).optional(),
  title: z.string().trim().max(300).optional(),
});
export type CaptureRequest = z.infer<typeof captureSchema>;

export interface CaptureResponse {
  item: ItemSummary;
  duplicate: boolean;
}

export const updateItemSchema = z
  .object({
    status: z.enum(["unread", "read", "archived"]).optional(),
    favorite: z.boolean().optional(),
    actionable: z.boolean().optional(),
    userNote: z.string().max(10_000).nullable().optional(),
    viewed: z.literal(true).optional(),
  })
  .strict();
export type UpdateItemRequest = z.infer<typeof updateItemSchema>;
