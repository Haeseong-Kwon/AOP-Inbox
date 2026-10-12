import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { imports, items, processingJobs, type ImportStats } from "@/db/schema";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { normalizeUrl, type NormalizedSource } from "@/lib/sources/normalize";
import { MAX_LINKS } from "./meta-export";

export const importLinksSchema = z.object({
  links: z
    .array(z.object({ url: z.string().max(2048), timestamp: z.number().int().positive().optional() }))
    .max(MAX_LINKS),
  includeOtherLinks: z.boolean().default(false),
});
export type ImportLinksRequest = z.infer<typeof importLinksSchema>;

export interface ImportPreview extends Omit<ImportStats, "created"> {
  newItems: number;
  newInstagram: number;
}

interface Candidate {
  source: NormalizedSource;
  savedAt?: Date;
}

const CHUNK = 500;
const chunks = <T,>(arr: T[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function classify(links: ImportLinksRequest["links"]) {
  const unique = new Map<string, Candidate>();
  let totalLinks = 0;
  for (const link of links) {
    const source = normalizeUrl(link.url);
    if (!source) continue;
    totalLinks++;
    const prev = unique.get(source.canonicalUrl);
    // Keep the earliest time it was shared — that's when it was "saved".
    const savedAt = link.timestamp ? new Date(link.timestamp) : undefined;
    if (!prev || (savedAt && (!prev.savedAt || savedAt < prev.savedAt))) unique.set(source.canonicalUrl, { source, savedAt });
  }
  return { totalLinks, unique: [...unique.values()] };
}

async function existingCanonicals(userId: string, canonicals: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(canonicals, CHUNK)) {
    const rows = await db
      .select({ url: items.canonicalUrl })
      .from(items)
      .where(and(eq(items.userId, userId), inArray(items.canonicalUrl, part)));
    rows.forEach((r) => r.url && found.add(r.url));
  }
  return found;
}

const isInstagramMedia = (s: NormalizedSource) => s.sourceType === "instagram" && s.contentKind !== "page";

export async function previewImport(userId: string, req: ImportLinksRequest): Promise<ImportPreview> {
  const { totalLinks, unique } = classify(req.links);
  const existing = await existingCanonicals(userId, unique.map((c) => c.source.canonicalUrl));
  const fresh = unique.filter((c) => !existing.has(c.source.canonicalUrl));
  const instagramReels = unique.filter((c) => isInstagramMedia(c.source) && c.source.contentKind !== "post").length;
  const instagramPosts = unique.filter((c) => isInstagramMedia(c.source) && c.source.contentKind === "post").length;
  const newInstagram = fresh.filter((c) => isInstagramMedia(c.source)).length;
  return {
    totalLinks,
    instagramReels,
    instagramPosts,
    otherLinks: unique.length - instagramReels - instagramPosts,
    // repeated shares inside the export + items already in the inbox
    duplicates: totalLinks - fresh.length,
    newInstagram,
    newItems: req.includeOtherLinks ? fresh.length : newInstagram,
  };
}

export async function commitImport(userId: string, req: ImportLinksRequest): Promise<{ importId: string; stats: ImportStats }> {
  const preview = await previewImport(userId, req);
  const { unique } = classify(req.links);
  const selected = unique.filter((c) => req.includeOtherLinks || isInstagramMedia(c.source));

  const [record] = await db
    .insert(imports)
    .values({ userId, source: "meta_export", status: "completed", stats: { ...preview, created: 0 } })
    .returning({ id: imports.id });

  let created = 0;
  for (const part of chunks(selected, CHUNK)) {
    const rows = await db
      .insert(items)
      .values(
        part.map(({ source, savedAt }) => ({
          userId,
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          canonicalUrl: source.canonicalUrl,
          externalId: source.externalId,
          contentKind: source.contentKind,
          importId: record.id,
          savedAt: savedAt ?? new Date(),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: items.id });
    created += rows.length;
    if (rows.length) {
      await db
        .insert(processingJobs)
        .values(rows.map((r) => ({ type: "process_item" as const, itemId: r.id, idempotencyKey: `process_item:${r.id}` })))
        .onConflictDoNothing();
    }
  }

  const stats: ImportStats = { ...preview, created };
  await db.update(imports).set({ stats }).where(eq(imports.id, record.id));
  log.info("import.committed", { importId: record.id, created, totalLinks: preview.totalLinks });
  return { importId: record.id, stats };
}
