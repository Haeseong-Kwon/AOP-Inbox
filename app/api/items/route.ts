import { NextResponse } from "next/server";
import { listItems } from "@/lib/items/repository";
import { listQuerySchema } from "@/lib/items/types";
import { withUser } from "@/lib/http";

export const GET = withUser(async (req, user) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(await listItems(user.id, listQuerySchema.parse(params)));
});
