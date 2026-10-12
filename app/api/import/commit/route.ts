import { after, NextResponse } from "next/server";
import { commitImport, importLinksSchema } from "@/lib/import/service";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { readJson, withUser } from "@/lib/http";

export const POST = withUser(async (req, user) => {
  const result = await commitImport(user.id, await readJson(req, importLinksSchema, 4_000_000));
  // Start analysis in the background; the inbox keeps nudging the queue until it drains.
  after(() => drainQueue(50_000));
  return NextResponse.json(result, { status: 201 });
});
