"use client";

import { Search, Zap } from "lucide-react";
import { NotificationList } from "@/components/app/notification-bell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CaptureForm } from "@/components/capture/capture-dialog";
import { InboxEmpty } from "@/components/inbox/empty-state";
import { ActionHint, ItemCard, ItemListSkeleton, ProcessingLine } from "@/components/inbox/item-views";
import { SourceIcon } from "@/components/inbox/source-icon";
import { greeting, relativeTime } from "@/lib/client/format";
import { useClientValue } from "@/lib/client/use-client-value";
import { useHome, useQueueNudge, type HomeData } from "@/lib/client/queries";
import type { ItemSummary } from "@/lib/items/types";

function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-2">
      <h2 className="text-[13.5px] font-medium text-muted-foreground">{title}</h2>
      {href && (
        <Link href={href} className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          {linkLabel ?? "View all"}
        </Link>
      )}
    </div>
  );
}

function CompactLink({ item, meta }: { item: ItemSummary; meta?: ReactNode }) {
  return (
    <Link
      href={`/inbox?item=${item.id}`}
      className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-accent/70"
    >
      <SourceIcon type={item.sourceType} className="mt-[3px] text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] leading-snug">{item.title}</span>
        {meta && <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>}
      </span>
    </Link>
  );
}

function statusSentence(data: HomeData): string {
  const { savedToday, unread, processing, total } = data.stats;
  if (total === 0) return "Nothing saved yet. Paste your first link below.";
  const parts = [
    savedToday > 0 ? `You saved ${savedToday} ${savedToday === 1 ? "thing" : "things"} today.` : `${total} items in your inbox.`,
    unread > 0 ? `${unread} still unread.` : "Everything's been read.",
  ];
  if (data.stats.appliedThisWeek > 0) parts.push(`${data.stats.appliedThisWeek} applied this week.`);
  if (processing > 0) parts.push(`${processing} being understood right now.`);
  return parts.join(" ");
}

export function HomeView() {
  const { data, isLoading, isError, error, refetch } = useHome();
  const router = useRouter();
  const hello = useClientValue(greeting, "Hello.");
  useQueueNudge(Boolean(data?.stats.processing));

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <header className="flex flex-col gap-2 pb-8">
        <p className="text-[15px] text-muted-foreground">{hello}</p>
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">
          Your knowledge, organized automatically.
        </h1>
        <p className="min-h-6 text-[15px] text-muted-foreground" aria-live="polite">
          {data ? statusSentence(data) : " "}
        </p>
      </header>

      <div className="mb-10 overflow-hidden rounded-xl border bg-card shadow-xs focus-within:border-signal/40">
        <CaptureForm mode="link" autoFocus={false} rows={2} onDone={() => void refetch()} />
      </div>

      {isLoading ? (
        <ItemListSkeleton rows={4} />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          {error.message}{" "}
          <button type="button" className="text-signal hover:underline" onClick={() => refetch()}>
            Try again
          </button>
        </p>
      ) : data!.stats.total === 0 ? (
        <InboxEmpty filtered={false} />
      ) : (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-10">
            {(data!.notifications.length > 0 || data!.waitingForYou.length > 0) && (
              <section aria-label="Waiting for you" className="rounded-xl border">
                <h2 className="border-b px-4 py-2.5 text-[13.5px] font-medium">Waiting for you</h2>
                {data!.notifications.length > 0 && <NotificationList notifications={data!.notifications} />}
                {data!.waitingForYou
                  .filter((i) => !data!.notifications.some((n) => n.itemId === i.id))
                  .map((item) => (
                    <Link key={item.id} href={`/items/${item.id}/setup`} className="flex items-center gap-3 border-t px-4 py-3 text-[14px] first:border-t-0 hover:bg-accent/60">
                      <Zap className="size-3.5 shrink-0 text-signal" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.actionState === "needs_approval" ? "Review required" : "Your step"}</span>
                    </Link>
                  ))}
              </section>
            )}
            <section aria-label="Recently saved">
              <SectionHeader title="Recently saved" href="/inbox" />
              <div className="-mx-4 sm:-mx-5">
                {data!.recent.map((item) => (
                  <ItemCard key={item.id} item={item} onOpen={(id) => router.push(`/inbox?item=${id}`)} />
                ))}
              </div>
            </section>
            {data!.continueReading.length > 0 && (
              <section aria-label="Continue where you left off">
                <SectionHeader title="Continue where you left off" href="/inbox?sort=viewed" />
                <div className="flex flex-col">
                  {data!.continueReading.map((item) => (
                    <CompactLink key={item.id} item={item} meta={item.collection ?? item.domain} />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="flex flex-col gap-10">
            <Link
              href="/search"
              className="flex h-10 items-center gap-2.5 rounded-lg border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              <Search className="size-4" aria-hidden />
              <span className="flex-1">Search by meaning…</span>
              <kbd className="font-mono text-[11px]">/</kbd>
            </Link>

            {data!.readyToApply.length > 0 && (
              <section aria-label="Ready to apply">
                <SectionHeader title="Ready to apply" href="/inbox?state=ready" />
                <div className="-mx-2 flex flex-col">
                  {data!.readyToApply.map((item) => (
                    <CompactLink key={item.id} item={item} meta={<ActionHint item={item} />} />
                  ))}
                </div>
              </section>
            )}

            {data!.recentlyApplied.length > 0 && (
              <section aria-label="Recently applied">
                <SectionHeader title="Recently applied" href="/activity" linkLabel="Activity" />
                <div className="-mx-2 flex flex-col">
                  {data!.recentlyApplied.map((item) => (
                    <CompactLink key={item.id} item={item} meta={item.appliedAt ? `Applied ${relativeTime(item.appliedAt)}` : undefined} />
                  ))}
                </div>
              </section>
            )}

            {data!.highValue.length > 0 && (
              <section aria-label="Worth your time">
                <SectionHeader title="Worth your time" href="/inbox?state=high-value" />
                <div className="-mx-2 flex flex-col">
                  {data!.highValue.map((item) => (
                    <CompactLink key={item.id} item={item} meta={item.collection} />
                  ))}
                </div>
              </section>
            )}

            {data!.unread.length > 0 && (
              <section aria-label="Unread">
                <SectionHeader title="Unread" href="/inbox?state=unread" />
                <div className="-mx-2 flex flex-col">
                  {data!.unread.map((item) => (
                    <CompactLink
                      key={item.id}
                      item={item}
                      meta={item.processingStatus === "completed" ? `Saved ${relativeTime(item.savedAt)}` : <ProcessingLine item={item} />}
                    />
                  ))}
                </div>
              </section>
            )}

            {data!.collections.length > 0 && (
              <section aria-label="Collections">
                <SectionHeader title="Collections" href="/collections" />
                <ul className="-mx-2 flex flex-col">
                  {data!.collections.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/inbox?collection=${c.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px] transition-colors hover:bg-accent/70"
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
