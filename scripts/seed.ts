/**
 * Development seed: `pnpm db:seed` (add `--reset` to wipe the dev user's items first).
 * Creates the dev account from DEV_USER_EMAIL / DEV_USER_PASSWORD and a realistic demo inbox.
 */
import { eq } from "drizzle-orm";
import { items, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { mockIntent } from "@/lib/ai/mock";
import { applyAnalysis, drainQueue, enqueueProcessing } from "@/lib/ingestion/pipeline";
import { normalizeUrl } from "@/lib/sources/normalize";
import { SEED_ITEMS } from "./seed-data";

const DAY = 86_400_000;

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
const email = process.env.DEV_USER_EMAIL;
const password = process.env.DEV_USER_PASSWORD;
if (!email || !password) throw new Error("Set DEV_USER_EMAIL and DEV_USER_PASSWORD in .env.local");

let owner = await db.query.user.findFirst({ where: eq(user.email, email) });
if (!owner) {
  await auth.api.signUpEmail({ body: { email, password, name: "Haeseong" } });
  owner = await db.query.user.findFirst({ where: eq(user.email, email) });
}
if (!owner) throw new Error("Could not create dev user (is it in AUTH_ALLOWED_EMAILS?)");
await db.update(user).set({ onboardedAt: new Date() }).where(eq(user.id, owner.id));

if (process.argv.includes("--reset")) await db.delete(items).where(eq(items.userId, owner.id));
// Additive: each demo item is inserted only if it isn't there yet, so re-running never touches your data.
const existingKeys = new Set(
  (await db.select({ url: items.canonicalUrl, note: items.userNote }).from(items).where(eq(items.userId, owner.id))).map((r) => r.url ?? `note:${r.note}`),
);
let added = 0;
for (const seed of SEED_ITEMS) {
  const source = seed.url ? normalizeUrl(seed.url) : null;
  if (existingKeys.has(source?.canonicalUrl ?? `note:${seed.note}`)) continue;
  added++;
  const now = Date.now();
  const [row] = await db
    .insert(items)
    .values({
      userId: owner.id,
      sourceType: source?.sourceType ?? "note",
      sourceUrl: source?.sourceUrl,
      canonicalUrl: source?.canonicalUrl,
      externalId: source?.externalId,
      contentKind: source?.contentKind,
      originalTitle: seed.originalTitle,
      creatorName: seed.creatorName,
      siteName: source?.sourceType === "instagram" ? "Instagram" : undefined,
      userNote: seed.note,
      contentText: seed.content,
      status: seed.status ?? "unread",
      favorite: seed.favorite ?? false,
      savedAt: new Date(now - seed.daysAgo * DAY),
      lastViewedAt: seed.viewedDaysAgo !== undefined ? new Date(now - seed.viewedDaysAgo * DAY) : undefined,
      processingStage: "analyze",
    })
    .returning();
  const analysis = { whatYouCanDo: "", ...mockIntent([seed.note, seed.content].filter(Boolean).join("\n")), ...seed.analysis };
  await applyAnalysis(row, analysis, "seed");
  await enqueueProcessing(row.id);
}

const processed = await drainQueue(120_000);
process.stdout.write(`Added ${added} demo items for ${email} (${processed} jobs processed).\n`);
process.exit(0);
