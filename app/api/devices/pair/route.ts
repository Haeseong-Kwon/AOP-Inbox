import { NextResponse } from "next/server";
import { createPairingCode } from "@/lib/execution/devices";
import { withUser } from "@/lib/http";

export const POST = withUser(async (_req, user) => {
  const { code, expiresAt } = await createPairingCode(user.id);
  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 });
});
