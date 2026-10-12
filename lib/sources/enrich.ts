import "server-only";
import type { SourceType } from "@/db/schema";
import { safeFetch } from "@/lib/security/safe-fetch";
import type { NormalizedSource } from "./normalize";

/**
 * Metadata enrichment. Policy-safe sources only: official oEmbed endpoints and
 * standard public HTML metadata. Instagram pages are never fetched directly —
 * without an oEmbed token an Instagram item keeps URL-only metadata.
 */

export interface SourceMetadata {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  creatorName?: string;
  creatorUrl?: string;
  siteName?: string;
  publishedAt?: Date;
  contentText?: string;
}

const MAX_CONTENT_CHARS = 8000;
const META_GRAPH_VERSION = "v23.0";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const clean = (s: string | undefined) => (s ? decodeEntities(s).replace(/\s+/g, " ").trim() || undefined : undefined);

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return clean(content);
  }
  return undefined;
}

function absolute(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function readableText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 30)
    .join("\n")
    .slice(0, MAX_CONTENT_CHARS);
}

export function extractHtmlMetadata(html: string, baseUrl: string): SourceMetadata {
  const published = metaContent(html, ["article:published_time", "og:published_time", "date", "pubdate"]);
  const date = published ? new Date(published) : undefined;
  return {
    title: metaContent(html, ["og:title", "twitter:title"]) ?? clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
    description: metaContent(html, ["og:description", "twitter:description", "description"]),
    thumbnailUrl: absolute(metaContent(html, ["og:image", "og:image:url", "twitter:image"]), baseUrl),
    siteName: metaContent(html, ["og:site_name", "application-name"]),
    creatorName: metaContent(html, ["author", "article:author", "twitter:creator"]),
    publishedAt: date && !Number.isNaN(date.getTime()) ? date : undefined,
    contentText: readableText(html) || undefined,
  };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const res = await safeFetch(url, { accept: "application/json", maxBytes: 200_000 });
  if (res.status !== 200) return null;
  return JSON.parse(res.body) as Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function enrichFromOEmbed(endpoint: string): Promise<SourceMetadata> {
  const data = await fetchJson(endpoint);
  if (!data) return {};
  return {
    title: str(data.title),
    creatorName: str(data.author_name),
    creatorUrl: str(data.author_url),
    thumbnailUrl: str(data.thumbnail_url),
    siteName: str(data.provider_name),
  };
}

async function enrichInstagram(source: NormalizedSource): Promise<SourceMetadata> {
  const token = process.env.META_OEMBED_TOKEN;
  if (!token || !source.externalId) return { siteName: "Instagram" };
  const params = new URLSearchParams({ url: source.canonicalUrl, access_token: token, omitscript: "true" });
  const meta = await enrichFromOEmbed(`https://graph.facebook.com/${META_GRAPH_VERSION}/instagram_oembed?${params}`);
  // Instagram's oEmbed "title" is the caption — it doubles as the best available content text.
  return { ...meta, siteName: "Instagram", contentText: meta.title };
}

async function enrichYouTube(source: NormalizedSource): Promise<SourceMetadata> {
  const params = new URLSearchParams({ url: source.canonicalUrl, format: "json" });
  return enrichFromOEmbed(`https://www.youtube.com/oembed?${params}`);
}

async function enrichWeb(source: NormalizedSource): Promise<SourceMetadata> {
  const res = await safeFetch(source.sourceUrl);
  if (res.status >= 400) throw new Error(`Source responded ${res.status}`);
  if (!/html|xml/i.test(res.contentType)) return {};
  return extractHtmlMetadata(res.body, res.url);
}

const ENRICHERS: Partial<Record<SourceType, (s: NormalizedSource) => Promise<SourceMetadata>>> = {
  instagram: enrichInstagram,
  youtube: enrichYouTube,
  web: enrichWeb,
  github: enrichWeb,
  x: enrichWeb,
  threads: enrichWeb,
  tiktok: (s) => enrichFromOEmbed(`https://www.tiktok.com/oembed?${new URLSearchParams({ url: s.canonicalUrl })}`),
};

export async function enrichSource(source: NormalizedSource): Promise<SourceMetadata> {
  const enricher = ENRICHERS[source.sourceType];
  return enricher ? enricher(source) : {};
}
