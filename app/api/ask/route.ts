import { z } from "zod";
import { searchHistory } from "@/db/schema";
import { db } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";
import { askInbox } from "@/lib/search/ask";
import { readJson, withUser } from "@/lib/http";

const askSchema = z.object({ question: z.string().trim().min(2, "Ask a question").max(1000) });

/**
 * Streams NDJSON: one {type:"sources"} line, then {type:"delta"} lines,
 * then {type:"done"} (or {type:"error"}).
 */
export const POST = withUser(async (req, user) => {
  const { question } = await readJson(req, askSchema, 8_000);
  const { sources, executions, setups, stream } = await askInbox(user.id, question);
  await db.insert(searchHistory).values({ userId: user.id, kind: "ask", query: question, resultCount: sources.length });

  const encoder = new TextEncoder();
  const line = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(line({ type: "sources", sources, executions, setups }));
      try {
        for await (const text of stream) controller.enqueue(line({ type: "delta", text }));
        controller.enqueue(line({ type: "done" }));
      } catch (error) {
        log.error("ask.stream_failed", { error: errorMessage(error) });
        controller.enqueue(line({ type: "error", message: "The answer was interrupted. Your sources are still listed below." }));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
});
