import "server-only";
import { userPreferences } from "@/db/schema";
import { db } from "@/lib/db";

export async function updatePreferences(userId: string, patch: Partial<typeof userPreferences.$inferInsert>): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...patch, updatedAt: new Date() } });
}
