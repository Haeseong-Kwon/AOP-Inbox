import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, unauthorized, UnauthorizedError, type SessionUser } from "@/lib/auth/session";
import { readBodyText } from "@/lib/body";
import { HttpError } from "@/lib/errors";
import { errorMessage, log } from "@/lib/log";

export { HttpError } from "@/lib/errors";

/**
 * Wraps an authenticated route handler: resolves the user, maps validation and
 * auth errors to friendly JSON, and never leaks internals to the client.
 */
export function withUser<C>(handler: (req: Request, user: SessionUser, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      // Defense in depth on top of SameSite cookies: reject cross-site writes.
      const origin = req.headers.get("origin");
      if (req.method !== "GET" && origin && new URL(origin).host !== req.headers.get("host")) {
        throw new HttpError(403, "Cross-site request blocked.");
      }
      const user = await requireApiUser();
      return await handler(req, user, ctx);
    } catch (error) {
      if (error instanceof UnauthorizedError) return unauthorized();
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
      }
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
      log.error("api.unhandled", { path: new URL(req.url).pathname, error: errorMessage(error) });
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 2_000_000): Promise<T> {
  const raw = await readBodyText(req, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  return schema.parse(body);
}
