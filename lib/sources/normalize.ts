import type { SourceType } from "@/db/schema";

/** Result of turning raw user input into a stable, dedupe-able source. Pure — safe on client and server. */
export interface NormalizedSource {
  sourceType: SourceType;
  /** The URL as the user gave it, minus tracking noise. Used for "Open original". */
  sourceUrl: string;
  /** Stable identity for duplicate detection. */
  canonicalUrl: string;
  externalId?: string;
  contentKind?: string;
}

export interface SourceAdapter {
  type: SourceType;
  canHandle(url: URL): boolean;
  normalize(url: URL): NormalizedSource;
}

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
  "igsh", "igshid", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "ref_src",
  "ref_url", "spm", "si",
]);
const isTrackingParam = (key: string) => key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase());

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");

/** Parse user input into an http(s) URL, or null when it is not one. Accepts bare domains ("example.com/x"). */
export function parseUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url;
  } catch {
    return null;
  }
}

/** Remove tracking params and fragments; keep params that carry meaning. Returns a new URL. */
export function stripTracking(url: URL): URL {
  const clean = new URL(url.toString());
  for (const key of [...clean.searchParams.keys()]) {
    if (isTrackingParam(key)) clean.searchParams.delete(key);
  }
  clean.searchParams.sort();
  // Hash-bang / hash-router fragments are meaningful; plain anchors are not.
  if (!/^#[!/]/.test(clean.hash)) clean.hash = "";
  return clean;
}

const INSTAGRAM_PATH = /^\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]+)/i;

const instagramAdapter: SourceAdapter = {
  type: "instagram",
  canHandle: (url) => ["instagram.com", "instagr.am"].includes(hostOf(url)),
  normalize(url) {
    const match = url.pathname.match(INSTAGRAM_PATH);
    const cleaned = stripTracking(url);
    if (!match) {
      // Profile or other Instagram page — still an Instagram source, URL-level identity.
      const canonical = `https://www.instagram.com${cleaned.pathname.replace(/\/?$/, "/")}`;
      return { sourceType: "instagram", sourceUrl: cleaned.toString(), canonicalUrl: canonical, contentKind: "page" };
    }
    const kind = match[1].toLowerCase().startsWith("reel") ? "reel" : match[1].toLowerCase() === "tv" ? "tv" : "post";
    const shortcode = match[2];
    const segment = kind === "post" ? "p" : kind;
    return {
      sourceType: "instagram",
      sourceUrl: cleaned.toString(),
      canonicalUrl: `https://www.instagram.com/${segment}/${shortcode}/`,
      externalId: shortcode,
      contentKind: kind,
    };
  },
};

const youtubeAdapter: SourceAdapter = {
  type: "youtube",
  canHandle: (url) => ["youtube.com", "youtu.be", "music.youtube.com"].includes(hostOf(url)),
  normalize(url) {
    const cleaned = stripTracking(url);
    const host = hostOf(url);
    let videoId: string | null = null;
    let kind = "video";
    if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0] || null;
    else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] || null;
      kind = "short";
    } else if (url.pathname.startsWith("/live/")) videoId = url.pathname.split("/")[2] || null;
    else videoId = url.searchParams.get("v");

    if (!videoId) {
      cleaned.hostname = "www.youtube.com";
      return { sourceType: "youtube", sourceUrl: cleaned.toString(), canonicalUrl: cleaned.toString(), contentKind: "page" };
    }
    const canonicalUrl =
      kind === "short" ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
    return { sourceType: "youtube", sourceUrl: cleaned.toString(), canonicalUrl, externalId: videoId, contentKind: kind };
  },
};

// Hosts we recognise for labelling; they use generic URL identity until they get a dedicated adapter.
const HOST_SOURCE_TYPES: Record<string, SourceType> = {
  "tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "threads.net": "threads",
  "threads.com": "threads",
  "github.com": "github",
};

const genericWebAdapter: SourceAdapter = {
  type: "web",
  canHandle: () => true,
  normalize(url) {
    const cleaned = stripTracking(url);
    const host = hostOf(url);
    const sourceType: SourceType =
      HOST_SOURCE_TYPES[host] ?? (/\.pdf$/i.test(url.pathname) ? "pdf" : "web");
    const canonical = new URL(cleaned.toString());
    canonical.protocol = "https:";
    canonical.hostname = host === "twitter.com" ? "x.com" : host;
    if (canonical.port === "443" || canonical.port === "80") canonical.port = "";
    if (canonical.pathname.length > 1) canonical.pathname = canonical.pathname.replace(/\/+$/, "");
    return { sourceType, sourceUrl: cleaned.toString(), canonicalUrl: canonical.toString() };
  },
};

// Order matters: first adapter that can handle the URL wins; generic web is the fallback.
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [instagramAdapter, youtubeAdapter, genericWebAdapter];

export function normalizeUrl(input: string): NormalizedSource | null {
  const url = parseUrl(input);
  if (!url) return null;
  const adapter = SOURCE_ADAPTERS.find((a) => a.canHandle(url))!;
  return adapter.normalize(url);
}

/** Pull the first URL out of free text (e.g. shared "Check this out https://…"). */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}
