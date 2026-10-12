import { NextResponse } from "next/server";
import { notificationsFor } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => NextResponse.json({ notifications: await notificationsFor(user.id) }));
