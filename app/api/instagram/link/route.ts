import { NextResponse } from "next/server";
import { createLinkCode, instagramConfig, linkStatus, unlink } from "@/lib/instagram";
import { HttpError, withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => NextResponse.json(await linkStatus(user.id)));

/** A fresh one-time code to DM to the bot (15 minutes). Only its hash is stored. */
export const POST = withUser(async (_req, user) => {
  if (!instagramConfig()) throw new HttpError(404, "Instagram DM saving isn't set up on this server.");
  const { code, expiresAt } = await createLinkCode(user.id);
  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 });
});

export const DELETE = withUser(async (_req, user) => {
  await unlink(user.id);
  return new NextResponse(null, { status: 204 });
});
