import type { SourceType } from "@/db/schema";
import { DEFAULT_LOCALE, translate, type Locale } from "@/lib/i18n";

const formatters = new Map<Locale, Intl.RelativeTimeFormat>();
function rtf(locale: Locale) {
  if (!formatters.has(locale)) formatters.set(locale, new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }));
  return formatters.get(locale)!;
}
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string, locale: Locale = DEFAULT_LOCALE, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Math.abs(seconds) < 60) return translate(locale, "just now");
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf(locale).format(Math.round(seconds / size), unit);
  }
  return translate(locale, "just now");
}

export function fullDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

export const SOURCE_LABELS: Record<SourceType, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  threads: "Threads",
  web: "Web",
  github: "GitHub",
  pdf: "PDF",
  note: "Note",
};

export function kindLabel(sourceType: SourceType, contentKind: string | null): string {
  if (sourceType === "instagram") return contentKind === "post" ? "Instagram post" : contentKind === "tv" ? "Instagram video" : "Instagram Reel";
  if (sourceType === "youtube") return contentKind === "short" ? "YouTube Short" : "YouTube";
  return SOURCE_LABELS[sourceType];
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Working late.";
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}
