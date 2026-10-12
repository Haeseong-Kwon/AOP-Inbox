import { NextResponse } from "next/server";
import { z } from "zod";
import { createExecutionJob } from "@/lib/execution/jobs";
import { jobView } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

/** "Run with AOP Inbox" — creates a job; the Mac dry-runs it before anything changes. */
export const POST = withUser<RouteContext<"/api/items/[id]/setup/run">>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const job = await createExecutionJob(user.id, id);
  return NextResponse.json({ job: await jobView(job) }, { status: 201 });
});
