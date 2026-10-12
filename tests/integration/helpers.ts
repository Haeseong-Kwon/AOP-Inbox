import { sql } from "drizzle-orm";
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { runMigrations } from "@/scripts/migrate";

let migrated = false;

/** Fresh schema state + one user. Runs against TEST_DATABASE_URL (see tests/setup.ts). */
export async function resetDatabase(): Promise<string> {
  if (!migrated) {
    await runMigrations(process.env.DATABASE_URL!);
    migrated = true;
  }
  await db.execute(sql`truncate table "user", processing_jobs, ai_usage restart identity cascade`);
  const id = "test-user";
  await db.insert(user).values({ id, name: "Test", email: "test@aop.local", onboardedAt: new Date() });
  return id;
}
