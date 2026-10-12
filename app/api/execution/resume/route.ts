import { NextResponse } from "next/server";
import { updatePreferences } from "@/lib/preferences";
import { withUser } from "@/lib/http";

/** Kill switch: while paused, no device starts or rolls back anything (dry runs still allowed). */
export const POST = withUser(async (_req, user) => {
  await updatePreferences(user.id, { executionPaused: false });
  return NextResponse.json({ executionPaused: false });
});
