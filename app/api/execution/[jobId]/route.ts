import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedJob } from "@/lib/execution/jobs";
import { jobView } from "@/lib/execution/views";
import { withUser } from "@/lib/http";

export const GET = withUser<RouteContext<"/api/execution/[jobId]">>(async (_req, user, ctx) => {
  const jobId = z.uuid().parse((await ctx.params).jobId);
  return NextResponse.json({ job: await jobView(await getOwnedJob(user.id, jobId)) });
});
