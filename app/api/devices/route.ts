import { NextResponse } from "next/server";
import { listDevices } from "@/lib/execution/devices";
import { deviceView } from "@/lib/execution/views";
import { preferencesFor } from "@/lib/notify";
import { withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => {
  const [devices, prefs] = await Promise.all([listDevices(user.id), preferencesFor(user.id)]);
  return NextResponse.json({ devices: devices.map(deviceView), executionPaused: prefs.executionPaused });
});
