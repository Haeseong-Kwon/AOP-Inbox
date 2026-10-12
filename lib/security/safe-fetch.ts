import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Fetch an arbitrary user-supplied URL without letting it reach internal
 * infrastructure (SSRF). The IP check runs inside the socket's DNS lookup, so
 * the address validated is the address connected to (no DNS-rebinding gap).
 */

// Separate lists: BlockList treats IPv4 and IPv4-mapped IPv6 as equivalent,
// so an IPv6 "::/96" rule would otherwise swallow every IPv4 address.
const blockedV4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(net, prefix, "ipv4");

const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["2002::", 16], // NAT64, discard, docs, 6to4
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(net, prefix, "ipv6");

/** IPv4 embedded in an IPv4-mapped / -compatible IPv6 address (dotted or hex form). */
function embeddedV4(address: string): string | null {
  const dotted = address.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = address.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPrivateAddress(input: string): boolean {
  const address = input.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (address === "::" || address === "::1") return true;
  const v4 = embeddedV4(address);
  if (v4) return blockedV4.check(v4, "ipv4");
  return blockedV6.check(address, "ipv6");
}

export class UnsafeUrlError extends Error {}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return callback(new UnsafeUrlError(`Blocked address for ${hostname}`), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
}

function requestOnce(url: URL, opts: Required<SafeFetchOptions>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: opts.timeoutMs,
        headers: {
          "user-agent": "AOP-InboxBot/1.0 (+metadata preview; respects robots)",
          accept: opts.accept,
          "accept-language": "en,ko;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            // Enough for <head> metadata — stop reading.
            chunks.push(chunk.subarray(0, Math.max(0, opts.maxBytes - (size - chunk.length))));
            res.destroy();
            return resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts: Required<SafeFetchOptions> = {
    timeoutMs: options.timeoutMs ?? 8000,
    maxBytes: options.maxBytes ?? 1_500_000,
    maxRedirects: options.maxRedirects ?? 4,
    accept: options.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
  };
  let url = new URL(input);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are fetched");
    if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Non-standard ports are not fetched");
    if (url.username || url.password) throw new UnsafeUrlError("Credentials in URLs are not fetched");
    // Node skips `lookup` for IP-literal hosts, so check those here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) !== 0 && isPrivateAddress(host)) throw new UnsafeUrlError("Private addresses are not fetched");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
      throw new UnsafeUrlError("Private hosts are not fetched");
    }
    const res = await requestOnce(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { url: url.toString(), status: res.status, contentType: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new Error("Too many redirects");
}
