import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { devicePairings, devices, type Device } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

/**
 * Device pairing + device-token auth. Device tokens only reach /api/agent/*;
 * they can't call user endpoints (those require the session cookie).
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PAIRING_TTL_MS = 10 * 60_000;
const MAX_PAIR_ATTEMPTS = 5;
// No 0/O/1/I/L — readable over the shoulder.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const LOOKUP_LEN = 4;
const SECRET_LEN = 6;
const randomChars = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * Code = 4-char public lookup id + 6-char secret ("ABCD-EFGHJK").
 * Attempts are counted per code: five wrong secrets burn that one code.
 * No shared or global counter, so nobody can lock other people out.
 */
export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const lookupId = randomChars(LOOKUP_LEN);
  const secret = randomChars(SECRET_LEN);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.insert(devicePairings).values({ userId, lookupId, codeHash: sha(secret), expiresAt });
  return { code: `${lookupId}-${secret}`, expiresAt };
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function pairDevice(input: { code: string; name: string; platform: string; arch: string; agentVersion: string }): Promise<{ deviceId: string; token: string }> {
  const normalized = normalizeCode(input.code);
  const lookupId = normalized.slice(0, LOOKUP_LEN);
  const secretHash = sha(normalized.slice(LOOKUP_LEN));
  const result = await db.transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(devicePairings)
      .where(and(eq(devicePairings.lookupId, lookupId), isNull(devicePairings.usedAt), gt(devicePairings.expiresAt, new Date())))
      .for("update");
    if (!pairing || pairing.attempts >= MAX_PAIR_ATTEMPTS) return null;
    if (!safeEqual(pairing.codeHash, secretHash)) {
      const attempts = pairing.attempts + 1;
      await tx
        .update(devicePairings)
        .set({ attempts, ...(attempts >= MAX_PAIR_ATTEMPTS ? { usedAt: new Date() } : {}) })
        .where(eq(devicePairings.id, pairing.id));
      return null;
    }
    const token = `aopd_${randomBytes(32).toString("base64url")}`;
    const [device] = await tx
      .insert(devices)
      .values({ userId: pairing.userId, name: input.name, platform: input.platform, arch: input.arch, agentVersion: input.agentVersion, tokenHash: sha(token), lastSeenAt: new Date() })
      .returning({ id: devices.id });
    await tx.update(devicePairings).set({ usedAt: new Date() }).where(eq(devicePairings.id, pairing.id));
    return { deviceId: device.id, token };
  });
  if (!result) throw new HttpError(401, "That code is invalid or has expired. Create a new one in Settings → Local Agent.");
  return result;
}

/** Fresh row on every use — a revoked or paused device must stop immediately, not on reconnect. */
export async function currentDevice(id: string): Promise<Device | null> {
  const [device] = await db.select().from(devices).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
  return device ?? null;
}

export async function authenticateDevice(req: Request): Promise<Device> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("aopd_")) throw new HttpError(401, "Device token required");
  const [device] = await db.select().from(devices).where(and(eq(devices.tokenHash, sha(token)), isNull(devices.revokedAt)));
  if (!device) throw new HttpError(401, "This device was revoked or never paired. Run `aop-inbox init` again.");
  return device;
}

export async function touchDevice(deviceId: string, info: Partial<Pick<Device, "agentVersion" | "executorVersion" | "platform" | "arch" | "osVersion">> = {}) {
  await db.update(devices).set({ ...info, lastSeenAt: new Date() }).where(eq(devices.id, deviceId));
}

export async function listDevices(userId: string): Promise<Device[]> {
  return db.select().from(devices).where(and(eq(devices.userId, userId), isNull(devices.revokedAt))).orderBy(desc(devices.lastSeenAt));
}

export async function primaryDevice(userId: string): Promise<Device | null> {
  const [d] = await listDevices(userId);
  return d ?? null;
}

export async function updateDevice(userId: string, id: string, patch: { paused?: boolean; autoRunLow?: boolean; name?: string }): Promise<boolean> {
  const rows = await db.update(devices).set(patch).where(and(eq(devices.id, id), eq(devices.userId, userId), isNull(devices.revokedAt))).returning({ id: devices.id });
  return rows.length > 0;
}

export async function revokeDevice(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(devices)
    .set({ revokedAt: new Date(), tokenHash: sql`'revoked:' || ${devices.id}::text` })
    .where(and(eq(devices.id, id), eq(devices.userId, userId), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

export const ONLINE_WINDOW_MS = 90_000;
export const isOnline = (d: Pick<Device, "lastSeenAt">) => Boolean(d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
