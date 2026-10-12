import { NextResponse } from "next/server";
import { z } from "zod";
import { collectionTree, createCollection } from "@/lib/collections/repository";
import { readJson, withUser } from "@/lib/http";

export const GET = withUser(async (_req, user) => NextResponse.json({ collections: await collectionTree(user.id) }));

export const POST = withUser(async (req, user) => {
  const { name } = await readJson(req, z.object({ name: z.string().trim().min(1).max(60) }), 4_000);
  return NextResponse.json({ id: await createCollection(user.id, name) }, { status: 201 });
});
