import { NextResponse } from "next/server";
import { AgentEventSchema } from "@aop-inbox/core";
import { withDevice } from "@/lib/execution/agent-http";
import { handleAgentEvent } from "@/lib/execution/gateway";
import { readJson } from "@/lib/http";

export const POST = withDevice(async (req, device) => {
  const event = await readJson(req, AgentEventSchema, 256_000);
  await handleAgentEvent(device, event);
  return NextResponse.json({ ok: true });
});
