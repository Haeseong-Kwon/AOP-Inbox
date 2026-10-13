import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { captureTokens } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";

/**
 * Capture-only tokens for iOS/macOS Shortcuts. A token can call POST/GET
 * /api/capture for its owner and nothing else: every other route still
 * requires the session cookie, and device tokens (aopd_) are separate.
 */

export const CAPTURE_TOKEN_PREFIX = "aopc_";
const MAX_TOKENS = 10;
/** Per-token fixed window — a leaked token can't flood the inbox. */
const WINDOW_LIMIT = 300;
const WINDOW = "1 hour";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface CaptureTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

export async function createCaptureToken(userId: string, name: string): Promise<{ token: string; view: CaptureTokenView }> {
  const active = await db.$count(captureTokens, and(eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)));
  if (active >= MAX_TOKENS) throw new HttpError(409, `You can have up to ${MAX_TOKENS} capture tokens. Revoke one you no longer use.`);
  const token = `${CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(captureTokens)
    .values({ userId, name, tokenHash: sha(token), prefix: token.slice(0, CAPTURE_TOKEN_PREFIX.length + 4) })
    .returning();
  return { token, view: toView(row) };
}

function toView(r: typeof captureTokens.$inferSelect): CaptureTokenView {
  return { id: r.id, name: r.name, prefix: r.prefix, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null, useCount: r.useCount };
}

export async function listCaptureTokens(userId: string): Promise<CaptureTokenView[]> {
  const rows = await db
    .select()
    .from(captureTokens)
    .where(and(eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)))
    .orderBy(desc(captureTokens.createdAt));
  return rows.map(toView);
}

export async function revokeCaptureToken(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(captureTokens)
    .set({ revokedAt: new Date(), tokenHash: sql`'revoked:' || ${captureTokens.id}::text` })
    .where(and(eq(captureTokens.id, id), eq(captureTokens.userId, userId), isNull(captureTokens.revokedAt)))
    .returning({ id: captureTokens.id });
  return rows.length > 0;
}

/** The bearer value if the request carries a capture token, otherwise null (→ session auth). */
export function bearerCaptureToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const value = header.replace(/^Bearer\s+/i, "").trim();
  return value.startsWith(CAPTURE_TOKEN_PREFIX) ? value : null;
}

/**
 * Validates the token and counts one use in a single atomic statement
 * (no check-then-act race). Throws 401 for unknown/revoked tokens, 429 over the limit.
 */
export async function consumeCaptureToken(token: string): Promise<{ userId: string; tokenId: string }> {
  const [row] = await db
    .update(captureTokens)
    .set({
      lastUsedAt: new Date(),
      useCount: sql`${captureTokens.useCount} + 1`,
      windowCount: sql`case when ${captureTokens.windowStart} < now() - ${WINDOW}::interval then 1 else ${captureTokens.windowCount} + 1 end`,
      windowStart: sql`case when ${captureTokens.windowStart} < now() - ${WINDOW}::interval then now() else ${captureTokens.windowStart} end`,
    })
    .where(and(eq(captureTokens.tokenHash, sha(token)), isNull(captureTokens.revokedAt)))
    .returning({ id: captureTokens.id, userId: captureTokens.userId, windowCount: captureTokens.windowCount });
  if (!row) throw new HttpError(401, "This capture token was revoked or doesn't exist. Create a new one in Settings → Capture.");
  if (row.windowCount > WINDOW_LIMIT) throw new HttpError(429, "Too many saves from this token in the last hour.");
  return { userId: row.userId, tokenId: row.id };
}
