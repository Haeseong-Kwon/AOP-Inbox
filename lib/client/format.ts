import type { SourceType } from "@/db/schema";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Math.abs(seconds) < 60) return "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
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
