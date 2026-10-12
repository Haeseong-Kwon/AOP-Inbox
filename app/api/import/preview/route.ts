import { NextResponse } from "next/server";
import { importLinksSchema, previewImport } from "@/lib/import/service";
import { readJson, withUser } from "@/lib/http";

// Body is URL + timestamp pairs only; message text never leaves the browser.
export const POST = withUser(async (req, user) => {
  return NextResponse.json(await previewImport(user.id, await readJson(req, importLinksSchema, 4_000_000)));
});
