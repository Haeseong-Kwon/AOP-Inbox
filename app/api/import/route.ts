import { NextResponse } from "next/server";
import { listImports } from "@/lib/import/service";
import { withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => NextResponse.json(await listImports(user.id)));
