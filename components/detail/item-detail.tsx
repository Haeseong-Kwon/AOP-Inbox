"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowUpRight, Check, Copy, Inbox, MoreHorizontal, RotateCw, Star, Trash2, X, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InstagramEmbed, instagramShortcode, ProcessingLine, SourceTile } from "@/components/inbox/item-views";
import { SourceIcon } from "@/components/inbox/source-icon";
import { fullDate, kindLabel, relativeTime } from "@/lib/client/format";
import { keys, useCheckActions, useDeleteItem, useItem, useRelated, useReprocess, useUpdateItem } from "@/lib/client/queries";
import { slugify } from "@/lib/ai/schemas";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ActionPanel } from "@/components/actions/action-panel";
import { AddToCollection } from "./add-to-collection";
import { NoteEditor } from "./note-editor";

interface ItemDetailProps {
  id: string;
  onClose?: () => void;
  onOpenItem: (id: string) => void;
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function IconAction({ label, shortcut, onClick, active, children }: { label: string; shortcut?: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} aria-pressed={active} className={cn(active && "text-foreground")}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <kbd className="ml-2 font-mono text-[10px] opacity-70">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ItemDetail({ id, onClose, onOpenItem }: ItemDetailProps) {
  const { data: item, isLoading, isError, error } = useItem(id);
  const ready = item?.processingStatus === "completed";
  const related = useRelated(id, ready);
  const update = useUpdateItem();
  const remove = useDeleteItem();
  const reprocess = useReprocess();
  const checkActions = useCheckActions(id);
  const qc = useQueryClient();
  const viewedRef = useRef<string | null>(null);
  const t = useT();
  const locale = useLocale();

  // Opening an item marks it viewed (and read) once per open.
  useEffect(() => {
    if (!item || viewedRef.current === item.id) return;
    viewedRef.current = item.id;
    update.mutate({ id: item.id, patch: { viewed: true } });
  }, [item, update]);

  if (isLoading) return <DetailSkeleton />;
  if (isError || !item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">{error?.message ?? t("This item doesn't exist anymore.")}</p>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("Close")}
          </Button>
        )}
      </div>
    );
  }

  const archived = item.status === "archived";
  const embedCode = instagramShortcode(item);
  const copyLink = async () => {
    if (!item.sourceUrl) return;
    await navigator.clipboard.writeText(item.sourceUrl);
    toast.success(t("Link copied"));
  };

  return (
    <article className="flex h-full flex-col" aria-labelledby="detail-title">
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-background/90 px-3 backdrop-blur sm:px-4">
        {onClose && (
          <IconAction label={t("Close")} shortcut="Esc" onClick={onClose}>
            <X />
          </IconAction>
        )}
        <div className="flex-1" />
        <IconAction label={t(item.favorite ? "Remove favorite" : "Favorite")} shortcut="F" active={item.favorite} onClick={() => update.mutate({ id, patch: { favorite: !item.favorite } })}>
          <Star className={cn(item.favorite && "fill-current")} />
        </IconAction>
        <IconAction
          label={t(archived ? "Move to Inbox" : "Archive")}
          shortcut="A"
          onClick={() => {
            update.mutate({ id, patch: { status: archived ? "read" : "archived" } });
            toast(t(archived ? "Moved back to Inbox" : "Archived"), {
              action: { label: t("Undo"), onClick: () => update.mutate({ id, patch: { status: archived ? "archived" : "read" } }) },
            });
          }}
        >
          {archived ? <Inbox /> : <Archive />}
        </IconAction>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("More actions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => update.mutate({ id, patch: { status: item.status === "unread" ? "read" : "unread" } })}>
              <Check /> {t(item.status === "unread" ? "Mark as read" : "Mark as unread")}
            </DropdownMenuItem>
            {item.sourceUrl && (
              <DropdownMenuItem onSelect={copyLink}>
                <Copy /> {t("Copy original link")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => reprocess.mutate(id)}>
              <RotateCw /> {t("Re-analyze")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => checkActions.mutate()}>
              <Zap /> {t("Check for actions")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                remove.mutate(id, {
                  onSuccess: () => {
                    toast(t("Deleted"));
                    qc.removeQueries({ queryKey: keys.item(id) });
                    onClose?.();
                  },
                })
              }
            >
              <Trash2 /> {t("Delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-[640px] flex-col gap-8 px-5 pt-6 pb-16 sm:px-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              {!embedCode && (item.thumbnailUrl || item.sourceType !== "note") && (
                <SourceTile item={item} className={cn(item.thumbnailUrl ? "h-24 w-24" : "h-16 w-16")} />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5 text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 text-foreground/80">
                  <SourceIcon type={item.sourceType} />
                  {t(kindLabel(item.sourceType, item.contentKind))}
                </span>
                {(item.creatorName || item.domain) &&
                  (item.creatorUrl ? (
                    <a href={item.creatorUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:text-foreground">
                      {item.creatorName ?? item.domain}
                    </a>
                  ) : (
                    <span className="truncate">{item.creatorName ?? item.domain}</span>
                  ))}
                <span title={fullDate(item.savedAt, locale)}>{t("Saved {time}", { time: relativeTime(item.savedAt, locale) })}</span>
              </div>
            </div>
            <h1 id="detail-title" className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-2xl">
              {item.title}
            </h1>
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex w-fit max-w-full items-center gap-1.5 truncate font-mono text-xs text-muted-foreground hover:text-signal"
              >
                <span className="truncate">{item.canonicalUrl?.replace(/^https?:\/\/(www\.)?/, "")}</span>
                <ArrowUpRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
                <span className="sr-only">{t("Open original")}</span>
              </a>
            )}
          </div>

          {embedCode && <InstagramEmbed key={embedCode} code={embedCode} title={item.title} />}

          {item.processingStatus !== "completed" && (
            <div className="rounded-lg border border-dashed px-4 py-3">
              <ProcessingLine item={item} />
            </div>
          )}

          {item.summary && <p className="font-reading text-[17.5px] leading-[1.65] text-foreground/90">{item.summary}</p>}

          {item.whyItMatters && (
            <section aria-labelledby="why-title" className="border-l-2 border-signal pl-5">
              <h2 id="why-title" className="mb-1.5 text-[13px] font-medium text-signal">
                {t("Why this matters")}
              </h2>
              <p className="font-reading text-[17px] leading-[1.6] text-foreground">{item.whyItMatters}</p>
            </section>
          )}

          {item.keyPoints.length > 0 && (
            <Section title={t("Key takeaways")}>
              <ul className="flex flex-col gap-2">
                {item.keyPoints.map((point) => (
                  <li key={point} className="flex gap-3 text-[14.5px] leading-relaxed">
                    <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <ActionPanel item={item} />

          {item.actionItems.length > 0 && !item.actionState?.match(/action_ready|applied|needs_approval|running|waiting_user|blocked/) && (
            <Section title={t("Action items")}>
              <ul className="flex flex-col gap-2">
                {item.actionItems.map((action) => (
                  <li key={action} className="flex gap-3 text-[14.5px] leading-relaxed">
                    <span className="mt-[0.3em] size-3.5 shrink-0 rounded-[4px] border border-foreground/30" aria-hidden />
                    {action}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t("My note")}>
            <NoteEditor key={item.id} itemId={item.id} initial={item.userNote} />
          </Section>

          <div className="flex flex-col gap-5">
            {item.tags.length > 0 && (
              <Section title={t("Tags")}>
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/inbox?tag=${encodeURIComponent(slugify(tag))}`}
                      className="rounded-md bg-muted px-2 py-1 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              </Section>
            )}
            <Section title={t("Collections")}>
              <div className="flex flex-wrap items-center gap-1.5">
                {item.collections.map((c) => (
                  <Link
                    key={c.id}
                    href={`/inbox?collection=${c.id}`}
                    className="rounded-md border px-2 py-1 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t(c.name)}
                  </Link>
                ))}
                <AddToCollection item={item} />
              </div>
            </Section>
          </div>

          {item.contentText && item.sourceType !== "note" && (
            <details className="group rounded-lg border">
              <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{t("Show extracted text")}</span>
                <span className="hidden group-open:inline">{t("Hide extracted text")}</span>
              </summary>
              <p className="max-h-96 overflow-y-auto border-t px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line text-muted-foreground">
                {item.contentText}
              </p>
            </details>
          )}

          {ready && (related.data?.length ?? 0) > 0 && (
            <Section title={t("Related")}>
              <ul className="-mx-2 flex flex-col">
                {related.data!.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onOpenItem(r.id)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                    >
                      <SourceIcon type={r.sourceType} className="text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{r.collection && t(r.collection)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </article>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-5 pt-[4.5rem] sm:px-8" aria-hidden>
      <div className="flex gap-4">
        <div className="size-16 rounded-md bg-muted" />
        <div className="flex flex-col gap-2 pt-1">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted/70" />
        </div>
      </div>
      <div className="h-6 w-4/5 rounded bg-muted" />
      <div className="flex flex-col gap-2.5 pt-2">
        <div className="h-3.5 w-full rounded bg-muted/70" />
        <div className="h-3.5 w-[92%] rounded bg-muted/70" />
        <div className="h-3.5 w-3/5 rounded bg-muted/70" />
      </div>
    </div>
  );
}
