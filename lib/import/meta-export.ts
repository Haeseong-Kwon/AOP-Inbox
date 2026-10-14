import { unzip, type UnzipFileInfo } from "fflate";
import { truncate } from "@/lib/utils";

/**
 * Meta "Download Your Information" parsing. Runs in the browser: the archive is
 * unpacked on-device and only links (with date, and the caption/author Meta
 * attached to a shared post) are sent to the server.
 *
 * Only two parts of the export are read: **Saved** and **DM threads**. A full
 * export also lists everything you viewed, liked or were shown in ads — those
 * files are never opened. Within a file, nothing depends on a fixed nesting:
 * we walk every value and pick URLs out of any string.
 */

/** Where a link came from: your Saved, your chat with yourself, or a chat with someone else. */
export type LinkOrigin = "saved" | "self" | "dm";
export const LINK_ORIGINS: readonly LinkOrigin[] = ["saved", "self", "dm"];

export interface ExtractedLink {
  url: string;
  /** epoch ms of the closest enclosing message, if any */
  timestamp?: number;
  origin?: LinkOrigin;
  /** The shared post's caption (DM shares only), trimmed. */
  caption?: string;
  /** The post's author username. */
  author?: string;
}

export const MAX_LINKS = 20_000;
export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3; // 2 GB compressed
const MAX_ENTRY_BYTES = 64 * 1024 ** 2; // per uncompressed text file
const MAX_TOTAL_TEXT_BYTES = 768 * 1024 ** 2; // zip-bomb guard
const URL_RE = /https?:\/\/[^\s<>"'`\\]+/gi;
const TEXT_ENTRY_RE = /\.(json|html?)$/i;
// your_instagram_activity/saved/saved_posts.json · …/messages/inbox/<thread>/message_1.json (older exports: no prefix).
// message_requests (strangers) and everything else are skipped.
const SAVED_PATH_RE = /(^|\/)saved\/[^/]+\.(json|html?)$/i;
const DM_PATH_RE = /(^|\/)messages\/inbox\/[^/]+\/[^/]+\.(json|html?)$/i;
const CAPTION_MAX = 1000;
const AUTHOR_MAX = 100;
const PRIORITY: Record<LinkOrigin, number> = { saved: 3, self: 2, dm: 1 };

function cleanUrl(raw: string): string {
  return raw.replace(/&amp;/g, "&").replace(/[),.;!?\]}]+$/, "");
}

function timestampOf(obj: Record<string, unknown>): number | undefined {
  if (typeof obj.timestamp_ms === "number") return obj.timestamp_ms;
  if (typeof obj.timestamp === "number") return obj.timestamp < 1e12 ? obj.timestamp * 1000 : obj.timestamp;
  return undefined;
}

/** Recursively collect URLs from any JSON value. Iterative to survive deep nesting. */
export function extractLinksFromJson(root: unknown, out: Map<string, ExtractedLink> = new Map()): Map<string, ExtractedLink> {
  const stack: Array<{ value: unknown; ts?: number }> = [{ value: root }];
  while (stack.length > 0 && out.size < MAX_LINKS) {
    const { value, ts } = stack.pop()!;
    if (typeof value === "string") {
      for (const match of value.matchAll(URL_RE)) {
        const url = cleanUrl(match[0]);
        if (!out.has(url)) out.set(url, { url, timestamp: ts });
      }
    } else if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, ts });
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const ownTs = timestampOf(obj) ?? ts;
      for (const child of Object.values(obj)) stack.push({ value: child, ts: ownTs });
    }
  }
  return out;
}

export function extractLinksFromText(text: string, out: Map<string, ExtractedLink> = new Map()): Map<string, ExtractedLink> {
  for (const match of text.matchAll(URL_RE)) {
    if (out.size >= MAX_LINKS) break;
    const url = cleanUrl(match[0]);
    if (!out.has(url)) out.set(url, { url });
  }
  return out;
}

/** Meta writes UTF-8 bytes as \u00XX escapes ("ì\u0095\u0088" for "안"). Undo that. */
export function fixMetaText(text: string): string {
  if (!/[\u0080-\u00ff]/.test(text) || /[^\u0000-\u00ff]/.test(text)) return text;
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Meta sometimes cuts a caption mid-character. If it's clearly escaped UTF-8 (a lead byte
    // followed by a continuation byte), decode anyway and drop the broken tail; else it's real Latin-1.
    return /[\u00c2-\u00f4][\u0080-\u00bf]/.test(text) ? new TextDecoder().decode(bytes).replace(/\uFFFD/g, "") : text;
  }
}

const clip = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? truncate(fixMetaText(value.trim()), max) : undefined);

/** Saved beats your own chat beats someone else's; the earliest date wins. */
function addLink(out: Map<string, ExtractedLink>, link: ExtractedLink) {
  const prev = out.get(link.url);
  if (!prev) {
    if (out.size < MAX_LINKS) out.set(link.url, link);
    return;
  }
  const better = PRIORITY[link.origin!] > PRIORITY[prev.origin!];
  out.set(link.url, {
    url: link.url,
    origin: better ? link.origin : prev.origin,
    timestamp: prev.timestamp && link.timestamp ? Math.min(prev.timestamp, link.timestamp) : (prev.timestamp ?? link.timestamp),
    caption: prev.caption ?? link.caption,
    author: prev.author ?? link.author,
  });
}

function addFrom(value: unknown, out: Map<string, ExtractedLink>, origin: LinkOrigin, extra: (url: string) => Partial<ExtractedLink> = () => ({})) {
  for (const link of extractLinksFromJson(value).values()) addLink(out, { ...link, origin, ...extra(link.url) });
}

type Thread = { participants?: { name?: unknown }[]; messages: { share?: { link?: unknown; share_text?: unknown; original_content_owner?: unknown } }[] };

function extractThread(thread: Thread, out: Map<string, ExtractedLink>) {
  const names = new Set((thread.participants ?? []).map((p) => p.name));
  const origin: LinkOrigin = names.size <= 1 ? "self" : "dm";
  for (const message of thread.messages) {
    const share = message?.share;
    const shared = typeof share?.link === "string" ? cleanUrl(share.link) : null;
    addFrom(message, out, origin, (url) =>
      url === shared ? { caption: clip(share!.share_text, CAPTION_MAX), author: clip(share!.original_content_owner, AUTHOR_MAX) } : {},
    );
  }
}

const PROFILE_URL_RE = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/;

type LabelValue = { label?: unknown; value?: unknown; href?: unknown; dict?: unknown };

/** First Instagram profile URL anywhere inside `value` → its username. */
function profileUsername(value: unknown): string | undefined {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") {
      const m = v.match(PROFILE_URL_RE);
      if (m) return m[1];
    } else if (v && typeof v === "object") stack.push(...Object.values(v));
  }
  return undefined;
}

/**
 * 2025+ format: `[{ timestamp, label_values: [{ label: "URL", href }, { label: "Caption", value }, { title: "Owner", dict: [...] }] }]`.
 * Labels come translated into the account's language ("캡션", "소유자"), so we go by shape, not label:
 * the entry's link is the top-level `href`, the caption the longest plain value, the author the owner's profile URL.
 */
function extractSavedEntry(entry: { timestamp?: unknown; label_values: LabelValue[] }, out: Map<string, ExtractedLink>) {
  const top = entry.label_values;
  const href = top.find((lv) => typeof lv.href === "string")?.href as string | undefined;
  if (!href) return;
  const texts = top.filter((lv) => !lv.href && typeof lv.value === "string").map((lv) => lv.value as string);
  const caption = texts.sort((a, b) => b.length - a.length)[0];
  const ts = typeof entry.timestamp === "number" ? (entry.timestamp < 1e12 ? entry.timestamp * 1000 : entry.timestamp) : undefined;
  addLink(out, {
    url: cleanUrl(href),
    timestamp: ts,
    origin: "saved",
    caption: clip(caption, CAPTION_MAX),
    author: ownerUsername(top) ?? profileUsername(top.filter((lv) => lv.dict)),
  });
}

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/** The owner group is the nested record with several fields (URL, name, username); hashtags have one each. */
function ownerUsername(top: LabelValue[]): string | undefined {
  for (const group of top) {
    if (!Array.isArray(group.dict)) continue;
    for (const record of group.dict as { dict?: LabelValue[] }[]) {
      const fields = Array.isArray(record?.dict) ? record.dict : [];
      if (fields.length < 2) continue;
      const name = fields.map((f) => f.value).findLast((v): v is string => typeof v === "string" && USERNAME_RE.test(v));
      if (name) return name;
    }
  }
  return undefined;
}

/** saved_posts.json / saved_collections.json, either export format. */
function extractSaved(root: unknown, out: Map<string, ExtractedLink>) {
  const entries = Array.isArray(root) ? root : root && typeof root === "object" ? Object.values(root).flat() : [];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && Array.isArray((entry as { label_values?: unknown }).label_values)) {
      extractSavedEntry(entry as { timestamp?: unknown; label_values: LabelValue[] }, out);
      continue;
    }
    // Older format: `{ saved_saved_media: [{ title: "<author>", string_map_data: { "Saved on": { href, timestamp } } }] }`
    const author = clip((entry as { title?: unknown })?.title, AUTHOR_MAX);
    addFrom(entry, out, "saved", () => (author ? { author } : {}));
  }
}

function originOfPath(name: string): LinkOrigin | null {
  if (SAVED_PATH_RE.test(name) || /^saved_[^/]*\.(json|html?)$/i.test(name)) return "saved";
  if (DM_PATH_RE.test(name) || /^message_\d+\.(json|html?)$/i.test(name)) return "dm";
  return null;
}

const isThread = (root: unknown): root is Thread => Boolean(root && typeof root === "object" && Array.isArray((root as Thread).messages));
const isSaved = (root: unknown): root is Record<string, unknown> =>
  Boolean(root && typeof root === "object" && Object.keys(root).some((k) => k.startsWith("saved_saved")));

function extractFromEntry(name: string, text: string, out: Map<string, ExtractedLink>) {
  if (/\.json$/i.test(name)) {
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      return; // malformed — skip rather than guess
    }
    if (isThread(root)) extractThread(root, out);
    else if (isSaved(root) || originOfPath(name) === "saved") extractSaved(root, out);
    return;
  }
  const origin = originOfPath(name);
  if (origin) for (const link of extractLinksFromText(text).values()) addLink(out, { ...link, origin });
}

function unzipTextEntries(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let budget = MAX_TOTAL_TEXT_BYTES;
  const filter = (file: UnzipFileInfo) => {
    // Only Saved and DM threads; viewed/liked/ads history is never opened.
    if (!TEXT_ENTRY_RE.test(file.name) || !originOfPath(file.name.toLowerCase()) || file.originalSize > MAX_ENTRY_BYTES) return false;
    budget -= file.originalSize;
    return budget >= 0;
  };
  return new Promise((resolve, reject) => unzip(data, { filter }, (err, files) => (err ? reject(err) : resolve(files))));
}

export class ImportFileError extends Error {}

/** Accepts a Meta export .zip, a single .json, or an .html message file. */
export async function extractLinksFromFile(file: File): Promise<ExtractedLink[]> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new ImportFileError("This file is larger than 2 GB.");
  const name = file.name.toLowerCase();
  const out = new Map<string, ExtractedLink>();

  if (name.endsWith(".zip")) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = await unzipTextEntries(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new ImportFileError("We couldn't open this ZIP file. Is it the archive Meta sent you?");
    }
    const decoder = new TextDecoder();
    for (const [entryName, bytes] of Object.entries(entries)) extractFromEntry(entryName, decoder.decode(bytes), out);
  } else if (/\.(json|html?)$/.test(name)) {
    extractFromEntry(name.split(/[\\/]/).pop()!, await file.text(), out);
  } else {
    throw new ImportFileError("Upload the .zip from Meta, or a .json / .html file from inside it.");
  }
  return [...out.values()];
}
