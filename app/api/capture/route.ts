import { after, NextResponse } from "next/server";
import { drainQueue } from "@/lib/ingestion/pipeline";
import { captureItem } from "@/lib/items/capture";
import { getSummaries } from "@/lib/items/repository";
import { captureSchema, type CaptureResponse } from "@/lib/items/types";
import { readJson, withUser } from "@/lib/http";

/** POST /api/capture — the stable capture API (quick capture, share target, future native apps). */
export const POST = withUser(async (req, user) => {
  const body = await readJson(req, captureSchema, 64_000);
  const { itemId, duplicate } = await captureItem(user.id, body);
  // Process right after the response is sent; the user never waits on AI.
  if (!duplicate) after(() => drainQueue(25_000));
  const [item] = await getSummaries(user.id, [itemId]);
  return NextResponse.json({ item, duplicate } satisfies CaptureResponse, { status: duplicate ? 200 : 201 });
});
