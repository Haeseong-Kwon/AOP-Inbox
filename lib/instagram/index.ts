import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { instagramInbound, instagramLinks } from "@/db/schema";
import { db } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";

/**
 * Save-by-DM through Meta's official Instagram messaging API: the user DMs a
 * reel to a dedicated bot account they control, Meta calls our webhook.
 * No Instagram passwords, cookies, private endpoints or scraping — only
 * messages sent to the bot are seen.
 */

export interface InstagramConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  /** The bot's Instagram professional account ID (the webhook `recipient.id`). */
  accountId: string;
  botUsername: string;
}

export function instagramConfig(): InstagramConfig | null {
  const c = {
    appSecret: process.env.INSTAGRAM_APP_SECRET ?? "",
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? "",
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
    accountId: process.env.INSTAGRAM_ACCOUNT_ID ?? "",
    botUsername: (process.env.INSTAGRAM_BOT_USERNAME ?? "").replace(/^@/, ""),
  };
  return Object.values(c).every(Boolean) ? c : null;
}

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>` */
export function validSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* ─── Linking an Instagram sender to a user ─────────────────────────────── */

// No 0/O/1/I/L: the code gets typed into a DM by hand.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60_000;
export const LINK_CODE_PATTERN = /\bSHULKER-([2-9A-HJKMNP-Z]{8})\b/i;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = `SHULKER-${Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db
    .insert(instagramLinks)
    .values({ userId, codeHash: sha(code), codeExpiresAt: expiresAt })
    .onConflictDoUpdate({ target: instagramLinks.userId, set: { codeHash: sha(code), codeExpiresAt: expiresAt } });
  return { code, expiresAt };
}

/** Binds the sender to whoever issued the code. One use; expired codes never match. */
export async function redeemLinkCode(igsid: string, text: string): Promise<string | null> {
  const match = text.toUpperCase().match(LINK_CODE_PATTERN);
  if (!match) return null;
  const [row] = await db
    .update(instagramLinks)
    .set({ igsid, linkedAt: new Date(), codeHash: null, codeExpiresAt: null })
    .where(and(eq(instagramLinks.codeHash, sha(`SHULKER-${match[1]}`)), gt(instagramLinks.codeExpiresAt, new Date())))
    .returning({ userId: instagramLinks.userId });
  return row?.userId ?? null;
}

export async function userForSender(igsid: string): Promise<string | null> {
  const row = await db.query.instagramLinks.findFirst({ where: eq(instagramLinks.igsid, igsid), columns: { userId: true } });
  return row?.userId ?? null;
}

export async function noteMessage(userId: string): Promise<void> {
  await db
    .update(instagramLinks)
    .set({ lastMessageAt: new Date(), messageCount: sql`${instagramLinks.messageCount} + 1` })
    .where(eq(instagramLinks.userId, userId));
}

export interface InstagramLinkView {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  linkedAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
}

export async function linkStatus(userId: string): Promise<InstagramLinkView> {
  const config = instagramConfig();
  const row = await db.query.instagramLinks.findFirst({ where: and(eq(instagramLinks.userId, userId), isNotNull(instagramLinks.igsid)) });
  return {
    configured: Boolean(config),
    botUsername: config?.botUsername ?? null,
    linked: Boolean(row),
    linkedAt: row?.linkedAt?.toISOString() ?? null,
    lastMessageAt: row?.lastMessageAt?.toISOString() ?? null,
    messageCount: row?.messageCount ?? 0,
  };
}

export async function unlink(userId: string): Promise<void> {
  await db.delete(instagramLinks).where(eq(instagramLinks.userId, userId));
}

/* ─── Redelivery guard ───────────────────────────────────────────────────── */

/** True the first time a message ID is seen. */
export async function firstDelivery(mid: string): Promise<boolean> {
  const rows = await db.insert(instagramInbound).values({ mid }).onConflictDoNothing().returning({ mid: instagramInbound.mid });
  return rows.length > 0;
}

export async function pruneInbound(): Promise<number> {
  const rows = await db
    .delete(instagramInbound)
    .where(lt(instagramInbound.receivedAt, sql`now() - interval '7 days'`))
    .returning({ mid: instagramInbound.mid });
  return rows.length;
}

/* ─── Replies ────────────────────────────────────────────────────────────── */

const GRAPH = "https://graph.instagram.com/v25.0";

/** Best effort: a failed reply never loses the save. Message text is not logged. */
export async function reply(config: InstagramConfig, igsid: string, text: string): Promise<void> {
  try {
    const res = await fetch(`${GRAPH}/${config.accountId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: igsid }, message: { text } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) log.warn("instagram.reply_failed", { status: res.status });
  } catch (error) {
    log.warn("instagram.reply_failed", { error: errorMessage(error) });
  }
}
