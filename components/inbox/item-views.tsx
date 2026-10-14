"use client";

import { Check, RotateCw, Star, Zap } from "lucide-react";
import { useState } from "react";
import type { ItemSummary } from "@/lib/items/types";
import { kindLabel, relativeTime } from "@/lib/client/format";
import { useReprocess } from "@/lib/client/queries";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./source-icon";

/** Thumbnail, or a typographic stand-in for items we have no image for (most Reels). */
export function SourceTile({ item, className }: { item: ItemSummary; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (item.thumbnailUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party hosts; no optimizer config
      <img
        src={item.thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-md border object-cover", className)}
      />
    );
  }
  // Monogram of the creator / site, like the letter on a library index card.
  const name = (item.creatorName ?? item.domain ?? item.title).replace(/^[@#]/, "");
  const letter = item.sourceType === "note" ? null : (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase();
  return (
    <div aria-hidden className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-surface", className)}>
      {letter ? (
        <span className="font-reading text-[26px] leading-none text-foreground/75">{letter}</span>
      ) : (
        <SourceIcon type={item.sourceType} className="size-5 text-muted-foreground" />
      )}
      {letter && <SourceIcon type={item.sourceType} className="absolute right-1.5 bottom-1.5 size-3 text-muted-foreground/80" />}
    </div>
  );
}

export function ProcessingLine({ item }: { item: Pick<ItemSummary, "id" | "processingStatus" | "processingError"> }) {
  const reprocess = useReprocess();
  const t = useT();
  if (item.processingStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        {t(item.processingError ?? "We saved this, but couldn't analyze it yet.")}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            reprocess.mutate(item.id);
          }}
          className="inline-flex items-center gap-1 rounded text-signal hover:underline"
        >
          <RotateCw className="size-3" aria-hidden /> {t("Retry")}
        </button>
      </span>
    );
  }
  if (item.processingStatus === "pending" || item.processingStatus === "processing") {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
        </span>
        {t("Understanding content…")}
      </span>
    );
  }
  return null;
}

interface ItemViewProps {
  item: ItemSummary;
  selected?: boolean;
  onOpen: (id: string) => void;
}

function Meta({ item }: { item: ItemSummary }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="flex min-w-0 items-center gap-x-3 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <SourceIcon type={item.sourceType} />
        <span className="truncate">{item.creatorName ?? item.domain ?? t(kindLabel(item.sourceType, item.contentKind))}</span>
      </span>
      <ActionHint item={item} />
      {item.collection && <span className="hidden truncate sm:inline">{t(item.collection)}</span>}
      <time dateTime={item.savedAt} className="shrink-0 tabular-nums">
        {relativeTime(item.savedAt, locale)}
      </time>
    </div>
  );
}

/** One quiet line about what you can do with this — only when there is something. */
export function ActionHint({ item }: { item: ItemSummary }) {
  const t = useT();
  const s = item.actionState;
  if (!s || s === "knowledge" || s === "analyzing") return null;
  const label =
    s === "applied"
      ? "Applied"
      : s === "needs_approval"
        ? "Review required"
        : s === "waiting_user"
          ? item.actionCount
            ? "Waiting for you"
            : "Guide needed"
          : s === "running"
            ? "Running on your Mac"
            : s === "blocked"
              ? "Manual steps only"
              : item.actionCount
                ? t(item.actionCount === 1 ? "{n} action" : "{n} actions", { n: item.actionCount })
                : "Things to try";
  const emphasised = s === "needs_approval" || s === "waiting_user";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", emphasised ? "text-signal" : "text-muted-foreground")}>
      {s === "applied" ? <Check className="size-3" aria-hidden /> : <Zap className="size-3" aria-hidden />}
      {t(label)}
    </span>
  );
}

function Flags({ item }: { item: ItemSummary }) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      {item.favorite && <Star className="size-3.5 fill-current text-foreground/80" aria-label={t("Favorite")} />}
    </span>
  );
}

const rowBase =
  "group relative flex w-full cursor-pointer text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:bg-accent/60 data-[selected=true]:bg-accent";

function UnreadMark({ item }: { item: ItemSummary }) {
  const t = useT();
  if (item.status !== "unread") return null;
  return <span className="absolute top-1/2 left-1.5 size-1.5 -translate-y-1/2 rounded-full bg-signal" aria-label={t("Unread")} />;
}

export function ItemCard({ item, selected, onOpen }: ItemViewProps) {
  const isReel = item.sourceType === "instagram" || item.contentKind === "short";
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-item-id={item.id}
      data-selected={selected}
      onClick={() => onOpen(item.id)}
      className={cn(rowBase, "gap-4 rounded-lg px-4 py-3.5 sm:px-5")}
    >
      <UnreadMark item={item} />
      <SourceTile item={item} className={cn("w-12 sm:w-16", isReel ? "h-16 sm:h-20" : "h-12 sm:h-16")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <h3 className={cn("line-clamp-2 flex-1 text-[15px] leading-snug tracking-[-0.005em]", item.status === "unread" ? "font-semibold" : "font-medium text-foreground/90")}>
            {item.title}
          </h3>
          <Flags item={item} />
        </div>
        {item.processingStatus === "completed" ? (
          item.summary && <p className="line-clamp-2 max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">{item.summary}</p>
        ) : (
          <ProcessingLine item={item} />
        )}
        <Meta item={item} />
      </div>
    </div>
  );
}

export function ItemRow({ item, selected, onOpen }: ItemViewProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-item-id={item.id}
      data-selected={selected}
      onClick={() => onOpen(item.id)}
      className={cn(rowBase, "h-10 items-center gap-3 rounded-md px-4 sm:px-5")}
    >
      <UnreadMark item={item} />
      <SourceIcon type={item.sourceType} className="text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate text-sm", item.status === "unread" ? "font-medium" : "text-foreground/85")}>
        {item.processingStatus === "pending" || item.processingStatus === "processing" ? (
          <span className="text-muted-foreground">{t("{title} — understanding…", { title: item.title })}</span>
        ) : (
          item.title
        )}
      </span>
      <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{item.creatorName ?? item.domain}</span>
      <Flags item={item} />
      <time dateTime={item.savedAt} className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {relativeTime(item.savedAt, locale)}
      </time>
    </div>
  );
}

export function ItemListSkeleton({ rows = 6, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-1" aria-hidden>
      {Array.from({ length: rows }, (_, i) =>
        compact ? (
          <div key={i} className="flex h-10 items-center gap-3 px-4">
            <div className="size-3.5 rounded bg-muted" />
            <div className="h-3 flex-1 rounded bg-muted" style={{ maxWidth: `${55 + ((i * 17) % 35)}%` }} />
          </div>
        ) : (
          <div key={i} className="flex gap-4 px-4 py-3.5 sm:px-5">
            <div className="h-16 w-16 rounded-md bg-muted" />
            <div className="flex flex-1 flex-col gap-2.5 pt-0.5">
              <div className="h-3.5 rounded bg-muted" style={{ width: `${50 + ((i * 13) % 40)}%` }} />
              <div className="h-3 w-[85%] rounded bg-muted/70" />
              <div className="h-2.5 w-32 rounded bg-muted/60" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
