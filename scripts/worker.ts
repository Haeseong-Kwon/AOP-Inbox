/**
 * Long-running queue worker for self-hosting: `pnpm worker`.
 * Not required in development — captures are processed right after the request.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { drainQueue } from "@/lib/ingestion/pipeline";

const IDLE_MS = 3000;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

while (!stopping) {
  const processed = await drainQueue(60_000);
  if (processed === 0) await sleep(IDLE_MS);
}
process.exit(0);
