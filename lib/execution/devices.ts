import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
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

export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const raw = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.insert(devicePairings).values({ userId, codeHash: sha(raw), expiresAt });
  return { code: `${raw.slice(0, 3)}-${raw.slice(3)}`, expiresAt };
}

// Global throttle on failed pairing attempts (codes are short-lived, but guessing must stay impractical).
const failures: number[] = [];
function tooManyFailures(): boolean {
  const cutoff = Date.now() - PAIRING_TTL_MS;
  while (failures.length && failures[0] < cutoff) failures.shift();
  return failures.length >= 30;
}

export async function pairDevice(input: { code: string; name: string; platform: string; arch: string; agentVersion: string }): Promise<{ deviceId: string; token: string }> {
  if (tooManyFailures()) throw new HttpError(429, "Too many pairing attempts. Create a new code and try again in a few minutes.");
  const codeHash = sha(normalizeCode(input.code));
  const result = await db.transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(devicePairings)
      .where(and(eq(devicePairings.codeHash, codeHash), isNull(devicePairings.usedAt), gt(devicePairings.expiresAt, new Date())))
      .for("update");
    if (!pairing || pairing.attempts >= MAX_PAIR_ATTEMPTS) return null;
    const token = `aopd_${randomBytes(32).toString("base64url")}`;
    const [device] = await tx
      .insert(devices)
      .values({ userId: pairing.userId, name: input.name, platform: input.platform, arch: input.arch, agentVersion: input.agentVersion, tokenHash: sha(token), lastSeenAt: new Date() })
      .returning({ id: devices.id });
    await tx.update(devicePairings).set({ usedAt: new Date() }).where(eq(devicePairings.id, pairing.id));
    return { deviceId: device.id, token };
  });
  if (!result) {
    failures.push(Date.now());
    throw new HttpError(401, "That code is invalid or has expired. Create a new one in Settings → Local Agent.");
  }
  return result;
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
