import "server-only";
import { eq } from "drizzle-orm";
import { notifications, userPreferences } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Notification center. In-app is the delivery that ships; Web Push / Telegram /
 * email plug in as additional Notifiers without touching callers.
 */

export type NotificationKind = (typeof notifications.$inferInsert)["kind"];

export interface NotificationPayload {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  itemId?: string | null;
  jobId?: string | null;
  dedupeKey: string;
  /** Approval requests and execution results are never held by quiet hours. */
  critical?: boolean;
}

export interface Notifier {
  id: string;
  notify(payload: NotificationPayload & { deliverAfter: Date }): Promise<void>;
}

const inApp: Notifier = {
  id: "in-app",
  async notify(p) {
    await db
      .insert(notifications)
      .values({ userId: p.userId, kind: p.kind, title: p.title, body: p.body, itemId: p.itemId ?? null, jobId: p.jobId ?? null, dedupeKey: p.dedupeKey, deliverAfter: p.deliverAfter })
      .onConflictDoNothing();
  },
};

const notifiers: Notifier[] = [inApp];
export function registerNotifier(n: Notifier): void {
  if (!notifiers.some((x) => x.id === n.id)) notifiers.push(n);
}

export async function preferencesFor(userId: string) {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return row ?? { userId, timezone: "UTC", quietStart: 22, quietEnd: 8, followUps: true, executionPaused: false };
}

/** Hour of day in a timezone (falls back to UTC on an unknown zone). */
function localHour(date: Date, timezone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(date));
  } catch {
    return date.getUTCHours();
  }
}

export function inQuietHours(date: Date, prefs: { timezone: string; quietStart: number; quietEnd: number }): boolean {
  const h = localHour(date, prefs.timezone);
  return prefs.quietStart > prefs.quietEnd ? h >= prefs.quietStart || h < prefs.quietEnd : h >= prefs.quietStart && h < prefs.quietEnd;
}

/** First moment at or after `date` that is outside quiet hours (hour resolution). */
export function nextDeliveryTime(date: Date, prefs: { timezone: string; quietStart: number; quietEnd: number }): Date {
  let t = new Date(date);
  for (let i = 0; i < 24 && inQuietHours(t, prefs); i++) {
    t = new Date(t.getTime() + 3_600_000);
    t.setUTCMinutes(0, 0, 0);
  }
  return t;
}

export async function notify(payload: NotificationPayload): Promise<void> {
  const prefs = await preferencesFor(payload.userId);
  const deliverAfter = payload.critical ? new Date() : nextDeliveryTime(new Date(), prefs);
  await Promise.all(notifiers.map((n) => n.notify({ ...payload, deliverAfter })));
}
