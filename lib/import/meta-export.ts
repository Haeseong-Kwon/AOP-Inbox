import { unzip, type UnzipFileInfo } from "fflate";

/**
 * Meta "Download Your Information" parsing. Runs in the browser: the archive is
 * unpacked on-device and only {url, timestamp} pairs are sent to the server.
 * The export schema changes over time, so nothing here depends on a fixed
 * nesting — we walk every value and pick URLs out of any string.
 */

export interface ExtractedLink {
  url: string;
  /** epoch ms of the closest enclosing message, if any */
  timestamp?: number;
}

export const MAX_LINKS = 20_000;
export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3; // 2 GB compressed
const MAX_ENTRY_BYTES = 64 * 1024 ** 2; // per uncompressed text file
const MAX_TOTAL_TEXT_BYTES = 768 * 1024 ** 2; // zip-bomb guard
const URL_RE = /https?:\/\/[^\s<>"'`\\]+/gi;
const TEXT_ENTRY_RE = /\.(json|html?)$/i;

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

function extractFromEntry(name: string, text: string, out: Map<string, ExtractedLink>) {
  if (/\.json$/i.test(name)) {
    try {
      extractLinksFromJson(JSON.parse(text), out);
      return;
    } catch {
      // Malformed JSON — fall through to plain-text scanning.
    }
  }
  extractLinksFromText(text, out);
}

function unzipTextEntries(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let budget = MAX_TOTAL_TEXT_BYTES;
  const filter = (file: UnzipFileInfo) => {
    if (!TEXT_ENTRY_RE.test(file.name) || file.originalSize > MAX_ENTRY_BYTES) return false;
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
    extractFromEntry(name, await file.text(), out);
  } else {
    throw new ImportFileError("Upload the .zip from Meta, or a .json / .html file from inside it.");
  }
  return [...out.values()];
}
