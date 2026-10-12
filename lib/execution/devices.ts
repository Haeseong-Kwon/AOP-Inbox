import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { authThrottle, devicePairings, devices, type Device } from "@/db/schema";
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

// Failed-attempt windows, stored in Postgres so they hold across restarts and instances.
const PER_CLIENT_FAILURES = 10;
const GLOBAL_FAILURES = 100;

async function failuresFor(key: string): Promise<number> {
  const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
  if (!row || Date.now() - row.windowStart.getTime() > PAIRING_TTL_MS) return 0;
  return row.count;
}

async function recordFailure(key: string): Promise<number> {
  const [row] = await db
    .insert(authThrottle)
    .values({ key, count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        count: sql`case when ${authThrottle.windowStart} < now() - interval '10 minutes' then 1 else ${authThrottle.count} + 1 end`,
        windowStart: sql`case when ${authThrottle.windowStart} < now() - interval '10 minutes' then now() else ${authThrottle.windowStart} end`,
      },
    })
    .returning({ count: authThrottle.count });
  return row.count;
}

export async function pairDevice(
  input: { code: string; name: string; platform: string; arch: string; agentVersion: string },
  client = "unknown",
): Promise<{ deviceId: string; token: string }> {
  const clientKey = `pair:client:${client}`;
  if ((await failuresFor(clientKey)) >= PER_CLIENT_FAILURES || (await failuresFor("pair:global")) >= GLOBAL_FAILURES) {
    throw new HttpError(429, "Too many pairing attempts. Create a new code and try again in a few minutes.");
  }
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
    await recordFailure(clientKey);
    if ((await recordFailure("pair:global")) >= GLOBAL_FAILURES) {
      // Someone is guessing at scale: burn every live code so a guess can't land.
      await db.update(devicePairings).set({ usedAt: new Date() }).where(isNull(devicePairings.usedAt));
    }
    throw new HttpError(401, "That code is invalid or has expired. Create a new one in Settings → Local Agent.");
  }
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
