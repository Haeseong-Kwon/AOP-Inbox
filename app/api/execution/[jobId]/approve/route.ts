import { NextResponse } from "next/server";
import { z } from "zod";
import { approveJob } from "@/lib/execution/jobs";
import { jobView } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

export const POST = withUser<RouteContext<"/api/execution/[jobId]/approve">>(async (_req, user, ctx) => {
  const jobId = z.uuid().parse((await ctx.params).jobId);
  return NextResponse.json({ job: await jobView(await approveJob(user.id, jobId)) });
});
