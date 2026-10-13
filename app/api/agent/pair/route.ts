import { NextResponse } from "next/server";
import { z } from "zod";
import { PairRequestSchema } from "@aop-inbox/core";
import { pairDevice } from "@/lib/execution/devices";
import { readBodyText } from "@/lib/body";
import { HttpError } from "@/lib/http";

/** CLI pairing: one-time code from Settings → device token (shown once, stored in the Mac's Keychain). */
export async function POST(req: Request) {
  try {
    const body = PairRequestSchema.parse(JSON.parse(await readBodyText(req, 4_000)));
    return NextResponse.json(await pairDevice(body), { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid pairing request" }, { status: 400 });
    throw error;
  }
}
