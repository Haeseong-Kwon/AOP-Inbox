import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { drainQueue } from "@/lib/ingestion/pipeline";

function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Drains the job queue. Called by an external cron (Bearer CRON_SECRET), by the
 * worker script, or by a signed-in client nudging a backlog after a big import.
 */
export async function POST(req: Request) {
  if (!hasCronSecret(req) && !(await getSessionUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const processed = await drainQueue(hasCronSecret(req) ? 250_000 : 20_000);
  return NextResponse.json({ processed });
}

/** Vercel Cron issues GET requests; GET only works with the cron secret. */
export async function GET(req: Request) {
  if (!hasCronSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ processed: await drainQueue(250_000) });
}
