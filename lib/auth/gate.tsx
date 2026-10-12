import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { user as userTable } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePageUser } from "./session";

/** Server-side gate for app pages: signed in and onboarded. Render inside <Suspense>. */
export async function AuthGate({ children, requireOnboarded = true }: { children: ReactNode; requireOnboarded?: boolean }) {
  const user = await requirePageUser();
  if (requireOnboarded) {
    const [row] = await db.select({ onboardedAt: userTable.onboardedAt }).from(userTable).where(eq(userTable.id, user.id));
    if (!row?.onboardedAt) redirect("/onboarding");
  }
  return <>{children}</>;
}
