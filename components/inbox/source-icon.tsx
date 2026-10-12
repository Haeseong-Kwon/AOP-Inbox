import { FileText, GitBranch, Globe, PenLine } from "lucide-react";
import type { SourceType } from "@/db/schema";
import { cn } from "@/lib/utils";

interface SourceIconProps {
  type: SourceType;
  className?: string;
}

/** Monochrome source glyphs. Brand marks are simplified on purpose — they inherit text color. */
export function SourceIcon({ type, className }: SourceIconProps) {
  const cls = cn("size-3.5 shrink-0", className);
  switch (type) {
    case "instagram":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={cls} aria-hidden>
          <rect x="2" y="2" width="12" height="12" rx="3.5" />
          <circle cx="8" cy="8" r="2.7" />
          <circle cx="11.6" cy="4.4" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "youtube":
    case "tiktok":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={cls} aria-hidden>
          <rect x="1.5" y="3.5" width="13" height="9" rx="2.5" />
          <path d="M6.8 6v4l3.4-2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "x":
    case "threads":
      return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={cls} aria-hidden>
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      );
    case "github":
      return <GitBranch className={cls} aria-hidden />;
    case "pdf":
      return <FileText className={cls} aria-hidden />;
    case "note":
      return <PenLine className={cls} aria-hidden />;
    default:
      return <Globe className={cls} aria-hidden />;
  }
}
