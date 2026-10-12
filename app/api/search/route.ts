import { NextResponse } from "next/server";
import { z } from "zod";
import { searchHistory } from "@/db/schema";
import { db } from "@/lib/db";
import { hybridSearch } from "@/lib/search/hybrid";
import { withUser } from "@/lib/http";

const querySchema = z.object({ q: z.string().trim().min(1).max(300), log: z.enum(["0", "1"]).default("1") });

export const GET = withUser(async (req, user) => {
  const { q, log } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const hits = await hybridSearch(user.id, q);
  if (log === "1") await db.insert(searchHistory).values({ userId: user.id, kind: "search", query: q, resultCount: hits.length });
  return NextResponse.json({ hits });
});
