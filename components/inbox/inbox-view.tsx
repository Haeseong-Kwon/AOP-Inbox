"use client";

import { AlignJustify, ArrowDownUp, LayoutList } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isTypingTarget } from "@/components/app/shortcuts";
import { ItemDetail } from "@/components/detail/item-detail";
import { EDIT_NOTE_EVENT } from "@/components/detail/note-editor";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SOURCE_LABELS } from "@/lib/client/format";
import { useCollections, useItems, useQueueNudge, useUpdateItem, type ListFilters } from "@/lib/client/queries";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { useStoredPreference } from "@/lib/client/use-client-value";
import { ITEM_SORTS, ITEM_STATES, SOURCE_FILTERS, type ItemSummary } from "@/lib/items/types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { InboxEmpty } from "./empty-state";
import { ItemCard, ItemListSkeleton, ItemRow } from "./item-views";

const STATE_LABELS: Record<(typeof ITEM_STATES)[number], string> = {
  unread: "Unread",
  read: "Read",
  favorite: "Favorites",
  actionable: "Actionable",
  archived: "Archived",
  "high-value": "High value",
  ready: "Ready to apply",
  "needs-approval": "Needs approval",
  waiting: "Waiting for you",
  applied: "Applied",
};
const SORT_LABELS: Record<(typeof ITEM_SORTS)[number], string> = {
  recent: "Recently saved",
  oldest: "Oldest",
  importance: "Importance",
  viewed: "Recently viewed",
};
const VIEW_KEY = "aop.inbox.view";

function pick<T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function useFilters(): ListFilters & { item: string | null } {
  const params = useSearchParams();
  return {
    source: pick(params.get("source"), SOURCE_FILTERS),
    state: pick(params.get("state"), ITEM_STATES),
    sort: pick(params.get("sort"), ITEM_SORTS) ?? "recent",
    collection: params.get("collection") ?? undefined,
    tag: params.get("tag") ?? undefined,
    intent: pick(params.get("intent"), ["executable", "actionable", "knowledge", "reference", "requires_user"] as const),
    item: params.get("item"),
  };
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 shrink-0 rounded-md px-2.5 text-[13px] transition-colors duration-150",
        active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function InboxView() {
  const { item: openId, ...filters } = useFilters();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wide = useMediaQuery("(min-width: 1280px)", true);
  const [view, setView] = useStoredPreference(VIEW_KEY, "comfortable");
  const compact = view === "compact";
  const [cursorId, setCursorId] = useState<string | null>(openId);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const update = useUpdateItem();
  const { data: collections } = useCollections();

  const query = useItems(filters);
  const items: ItemSummary[] = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  useQueueNudge(items.some((i) => i.processingStatus === "pending" || i.processingStatus === "processing"));

  const toggleView = () => setView(compact ? "comfortable" : "compact");

  const setParams = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace" = "replace") => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const url = `${pathname}${next.size ? `?${next}` : ""}`;
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router],
  );

  const openItem = useCallback(
    (id: string) => {
      setCursorId(id);
      setParams({ item: id }, openId ? "replace" : "push");
    },
    [openId, setParams],
  );
  const closeItem = useCallback(() => setParams({ item: null }), [setParams]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  // Keyboard: J/K move, Enter open, F/A/U/E/O act, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      const index = items.findIndex((i) => i.id === (cursorId ?? openId));
      const current = items[index];
      const move = (delta: number) => {
        const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
        if (!next) return;
        setCursorId(next.id);
        if (openId) setParams({ item: next.id });
        listRef.current?.querySelector(`[data-item-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const key = e.key.toLowerCase();
      if (key === "j" || e.key === "ArrowDown") move(index < 0 ? 0 : 1);
      else if (key === "k" || e.key === "ArrowUp") move(index < 0 ? 0 : -1);
      else if (e.key === "Enter" && current) openItem(current.id);
      else if (e.key === "Escape" && openId) closeItem();
      else if (!current) return;
      else if (key === "f") update.mutate({ id: current.id, patch: { favorite: !current.favorite } });
      else if (key === "u") update.mutate({ id: current.id, patch: { status: current.status === "unread" ? "read" : "unread" } });
      else if (key === "a") {
        const archived = current.status === "archived";
        update.mutate({ id: current.id, patch: { status: archived ? "read" : "archived" } });
        toast(t(archived ? "Moved back to Inbox" : "Archived"));
      } else if (key === "o" && current.sourceUrl) window.open(current.sourceUrl, "_blank", "noopener,noreferrer");
      else if (key === "e") {
        if (!openId) openItem(current.id);
        setTimeout(() => window.dispatchEvent(new Event(EDIT_NOTE_EVENT)), openId ? 0 : 350);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursorId, openId, openItem, closeItem, setParams, update, t]);

  const collectionName = useMemo(() => {
    if (!filters.collection || !collections) return null;
    for (const c of collections) {
      const name = c.kind === "manual" ? c.name : t(c.name);
      if (c.id === filters.collection) return name;
      const child = c.children.find((ch) => ch.id === filters.collection);
      if (child) return `${name} / ${child.name}`;
    }
    return t("Collection");
  }, [filters.collection, collections, t]);

  const title =
    collectionName ??
    (filters.tag ? `#${filters.tag}` : t(filters.source ? SOURCE_LABELS[filters.source] : filters.state ? STATE_LABELS[filters.state] : "Inbox"));
  const filtered = Boolean(filters.source || filters.state || filters.collection || filters.tag);
  const showPane = Boolean(openId) && wide;

  const list = (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={t("Sort")}>
                <ArrowDownUp aria-hidden />
                <span className="hidden sm:inline">{t(SORT_LABELS[filters.sort ?? "recent"])}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={filters.sort} onValueChange={(v) => setParams({ sort: v === "recent" ? null : v })}>
                {ITEM_SORTS.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {t(SORT_LABELS[s])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={toggleView} aria-label={t(compact ? "Comfortable view" : "Compact view")} className="text-muted-foreground">
            {compact ? <LayoutList /> : <AlignJustify />}
          </Button>
        </div>
        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto px-3 pb-2.5 sm:px-5">
          <FilterChip active={!filters.source} onClick={() => setParams({ source: null })}>
            {t("All")}
          </FilterChip>
          {(["instagram", "web", "note"] as const).map((s) => (
            <FilterChip key={s} active={filters.source === s} onClick={() => setParams({ source: filters.source === s ? null : s })}>
              {t(s === "note" ? "Notes" : SOURCE_LABELS[s])}
            </FilterChip>
          ))}
          <span className="mx-2 h-4 w-px shrink-0 bg-border" aria-hidden />
          {(["unread", "read", "favorite", "actionable", "ready", "waiting", "applied", "archived"] as const).map((s) => (
            <FilterChip key={s} active={filters.state === s} onClick={() => setParams({ state: filters.state === s ? null : s })}>
              {t(STATE_LABELS[s])}
            </FilterChip>
          ))}
          {(filters.collection || filters.tag) && (
            <FilterChip active onClick={() => setParams({ collection: null, tag: null })}>
              {t(filters.tag ? "Clear tag ×" : "Clear collection ×")}
            </FilterChip>
          )}
        </div>
      </header>

      <div ref={listRef} role="listbox" aria-label={title} className="flex-1 px-1 py-2 pb-24 md:pb-6 sm:px-2">
        {query.isLoading ? (
          <ItemListSkeleton compact={compact} />
        ) : query.isError ? (
          <div className="px-5 py-16 text-sm text-muted-foreground">
            {query.error.message}{" "}
            <button type="button" className="text-signal hover:underline" onClick={() => query.refetch()}>
              {t("Try again")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <InboxEmpty filtered={filtered} />
        ) : (
          <>
            {items.map((item) =>
              compact ? (
                <ItemRow key={item.id} item={item} selected={item.id === (openId ?? cursorId)} onOpen={openItem} />
              ) : (
                <ItemCard key={item.id} item={item} selected={item.id === (openId ?? cursorId)} onOpen={openItem} />
              ),
            )}
            <div ref={sentinelRef} className="h-px" />
            {query.isFetchingNextPage && <ItemListSkeleton rows={2} compact={compact} />}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {list}
      {showPane && (
        <aside className="sticky top-0 h-dvh w-[min(46vw,600px)] shrink-0 border-l bg-background animate-in fade-in-0 slide-in-from-right-4 duration-200">
          <ItemDetail key={openId} id={openId!} onClose={closeItem} onOpenItem={openItem} />
        </aside>
      )}
      {!wide && (
        <Sheet open={Boolean(openId)} onOpenChange={(open) => !open && closeItem()}>
          <SheetContent side="right" showCloseButton={false} className="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
            <SheetTitle className="sr-only">{t("Item details")}</SheetTitle>
            <SheetDescription className="sr-only">{t("Summary, notes and related items")}</SheetDescription>
            {openId && <ItemDetail key={openId} id={openId} onClose={closeItem} onOpenItem={openItem} />}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
