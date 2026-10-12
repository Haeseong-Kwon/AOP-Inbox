/**
 * Re-embed items whose embedding is missing for the current AI_EMBEDDING_MODEL
 * (after switching models or bumping KNOWLEDGE_DOC_VERSION): `pnpm reindex`.
 */
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { drainQueue, enqueueStaleEmbeddings } from "@/lib/ingestion/pipeline";

let queued = 0;
for (const { id } of await db.select({ id: user.id }).from(user)) queued += await enqueueStaleEmbeddings(id);
let processed = 0;
for (let n = -1; n !== 0; ) processed += n = await drainQueue(60_000);
process.stdout.write(`Queued ${queued} items for re-embedding; processed ${processed}.\n`);
process.exit(0);
