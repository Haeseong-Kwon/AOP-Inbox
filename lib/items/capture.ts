import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { items } from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueProcessing, reprocessItem } from "@/lib/ingestion/pipeline";
import { log } from "@/lib/log";
import { extractFirstUrl, normalizeUrl, parseUrl } from "@/lib/sources/normalize";
import type { CaptureRequest } from "./types";
import { truncate } from "@/lib/utils";

export interface CaptureResult {
  itemId: string;
  duplicate: boolean;
}

function joinNotes(...notes: (string | null | undefined)[]): string | null {
  const parts = notes.map((n) => n?.trim()).filter((n): n is string => Boolean(n));
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * The single entry point for saving anything (quick capture, share target,
 * future native apps). Saving never waits on AI: we insert, enqueue, return.
 */
export async function captureItem(userId: string, req: CaptureRequest): Promise<CaptureResult> {
  const input = req.input.trim();
  const url = parseUrl(input) ? input : extractFirstUrl(input);
  const source = url ? normalizeUrl(url) : null;

  if (!source) {
    const [note] = await db
      .insert(items)
      .values({ userId, sourceType: "note", userNote: joinNotes(input, req.note), originalTitle: req.title || null, processingStage: "analyze" })
      .returning({ id: items.id });
    await enqueueProcessing(note.id);
    log.info("capture.note", { itemId: note.id });
    return { itemId: note.id, duplicate: false };
  }

  // Text around a shared link ("this is how I'd do onboarding → https://…") is the user's note.
  const surrounding = url && url !== input ? input.replace(url, "").trim() : "";
  const note = joinNotes(surrounding.length > 2 ? surrounding : null, req.note);

  const [created] = await db
    .insert(items)
    .values({
      userId,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      canonicalUrl: source.canonicalUrl,
      externalId: source.externalId,
      contentKind: source.contentKind,
      originalTitle: req.title || null,
      userNote: note,
    })
    .onConflictDoNothing({ target: [items.userId, items.canonicalUrl], where: sql`canonical_url is not null` })
    .returning({ id: items.id });

  if (created) {
    await enqueueProcessing(created.id);
    log.info("capture.link", { itemId: created.id, sourceType: source.sourceType });
    return { itemId: created.id, duplicate: false };
  }

  const existing = await db.query.items.findFirst({
    where: and(eq(items.userId, userId), eq(items.canonicalUrl, source.canonicalUrl)),
    columns: { id: true, userNote: true },
  });
  if (!existing) throw new Error("Duplicate detected but original item not found");
  // Re-saving with a note adds the note to the original instead of creating a copy.
  if (note && !existing.userNote?.includes(note)) {
    await db.update(items).set({ userNote: joinNotes(existing.userNote, note) }).where(eq(items.id, existing.id));
    await reprocessItem(existing.id);
  }
  log.info("capture.duplicate", { itemId: existing.id });
  return { itemId: existing.id, duplicate: true };
}

export interface InstagramShare {
  /** Instagram media ID from the DM webhook. No permalink is provided, so this is the identity. */
  mediaId: string;
  kind: "reel" | "post";
  /** The post's caption as Meta sends it in the share. */
  caption: string | null;
}

const CAPTION_LIMIT = 4_000;

/**
 * A reel/post shared to the AOP Inbox bot by DM. Meta sends the caption and a
 * signed CDN asset URL, not the instagram.com permalink; we keep the caption,
 * never fetch or store the media.
 */
export async function captureInstagramShare(userId: string, share: InstagramShare): Promise<CaptureResult> {
  const existing = await db.query.items.findFirst({
    where: and(eq(items.userId, userId), eq(items.sourceType, "instagram"), eq(items.externalId, share.mediaId)),
    columns: { id: true },
  });
  if (existing) {
    log.info("capture.duplicate", { itemId: existing.id });
    return { itemId: existing.id, duplicate: true };
  }
  const caption = (share.caption && truncate(share.caption.trim(), CAPTION_LIMIT)) || null;
  const [created] = await db
    .insert(items)
    .values({
      userId,
      sourceType: "instagram",
      externalId: share.mediaId,
      contentKind: share.kind,
      originalTitle: caption ? truncate(caption.split("\n")[0], 140) : null,
      contentText: caption,
      // Nothing to enrich without a permalink; go straight to analysis.
      processingStage: "analyze",
    })
    .returning({ id: items.id });
  await enqueueProcessing(created.id);
  log.info("capture.instagram_dm", { itemId: created.id, kind: share.kind });
  return { itemId: created.id, duplicate: false };
}
