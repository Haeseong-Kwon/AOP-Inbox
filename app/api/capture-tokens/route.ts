import { NextResponse } from "next/server";
import { z } from "zod";
import { createCaptureToken, listCaptureTokens } from "@/lib/capture-tokens";
import { readJson, withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => NextResponse.json({ tokens: await listCaptureTokens(user.id) }));

/** Returns the token once; only its hash is stored. */
export const POST = withUser(async (req, user) => {
  const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(60) }).strict(), 2_000);
  const { token, view } = await createCaptureToken(user.id, name);
  return NextResponse.json({ token, view }, { status: 201 });
});
