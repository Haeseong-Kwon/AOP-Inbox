import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Device } from "@/db/schema";
import { HttpError } from "@/lib/errors";
import { errorMessage, log } from "@/lib/log";
import { authenticateDevice } from "./devices";

/** Route wrapper for /api/agent/*: device token only — session cookies are ignored here. */
export function withDevice(handler: (req: Request, device: Device) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req, await authenticateDevice(req));
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
      log.error("agent_api.unhandled", { path: new URL(req.url).pathname, error: errorMessage(error) });
      return NextResponse.json({ error: "Gateway error" }, { status: 500 });
    }
  };
}
