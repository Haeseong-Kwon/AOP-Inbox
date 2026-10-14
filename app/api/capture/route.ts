import { after, NextResponse } from "next/server";
import { z } from "zod";
import { bearerCaptureToken, consumeCaptureToken } from "@/lib/capture-tokens";
import { readBodyText } from "@/lib/body";
import { HttpError } from "@/lib/errors";
import { localeFromCookieHeader, translate } from "@/lib/i18n";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { getSummaries } from "@/lib/items/repository";
import { captureFieldsSchema, type CaptureResponse } from "@/lib/items/types";
import { readJson, withUser } from "@/lib/http";
import { errorMessage, log } from "@/lib/log";

/**
 * POST /api/capture — the one capture API: quick capture, share target,
 * iOS/macOS Shortcuts (Authorization: Bearer aopc_…), future native apps.
 */

const MAX_BODY = 64_000;

async function readFields(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return readJson(req, captureFieldsSchema, MAX_BODY);
  // Every other body is read through the same streaming byte cap before parsing.
  const raw = await readBodyText(req, MAX_BODY);
  if (type.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(raw);
    const pick = (k: string) => form.get(k) ?? undefined;
    return captureFieldsSchema.parse({ input: pick("input"), url: pick("url"), text: pick("text"), title: pick("title"), note: pick("note") });
  }
  if (type.includes("multipart/form-data")) throw new HttpError(415, "Send JSON, a form, or plain text.");
  // Plain text body (e.g. a Shortcut sending "Shortcut Input" as the request body).
  return captureFieldsSchema.parse({ input: raw.slice(0, 20_000) });
}

async function capture(req: Request, userId: string): Promise<Response> {
  const body = await readFields(req);
  const { itemId, duplicate } = await captureItem(userId, body);
  // Process right after the response is sent; the user never waits on AI.
  if (!duplicate) after(() => drainQueue(25_000));
  const [item] = await getSummaries(userId, [itemId]);
  const title = item.title.length > 60 ? `${item.title.slice(0, 57)}…` : item.title;
  // Cookie-less Shortcut calls get the default locale (Korean).
  const locale = localeFromCookieHeader(req.headers.get("cookie"));
  const message = duplicate
    ? translate(locale, "Already in your Inbox — {title}", { title })
    : translate(locale, item.sourceType === "note" ? "Note saved to AOP Inbox" : "Saved to AOP Inbox");
  return NextResponse.json({ item, duplicate, message } satisfies CaptureResponse, { status: duplicate ? 200 : 201 });
}

/** Token path: no cookies involved, so no CSRF surface; errors carry `message` for the Shortcut notification. */
async function withCaptureToken(req: Request, token: string, handler: (userId: string) => Promise<Response>): Promise<Response> {
  try {
    const { userId } = await consumeCaptureToken(token);
    return await handler(userId);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
    const english =
      error instanceof HttpError ? error.message : error instanceof z.ZodError ? (error.issues[0]?.message ?? "Invalid request") : "AOP Inbox couldn't save this. Try again.";
    const message = translate(localeFromCookieHeader(req.headers.get("cookie")), english);
    if (status === 500) log.error("capture.token_failed", { error: errorMessage(error) });
    return NextResponse.json({ error: message, message }, { status });
  }
}

const sessionPost = withUser(async (req, user) => capture(req, user.id));

export async function POST(req: Request, ctx: unknown) {
  const token = bearerCaptureToken(req);
  return token ? withCaptureToken(req, token, (userId) => capture(req, userId)) : sessionPost(req, ctx);
}

/** GET with a capture token: "is my Shortcut connected?" — used by the Settings test and by people setting up. */
export async function GET(req: Request) {
  const token = bearerCaptureToken(req);
  if (!token) return NextResponse.json({ error: "Send a capture token: Authorization: Bearer aopc_…" }, { status: 401 });
  return withCaptureToken(req, token, async () => NextResponse.json({ ok: true, message: translate(localeFromCookieHeader(req.headers.get("cookie")), "Connected to AOP Inbox") }));
}
