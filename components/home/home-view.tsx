"use client";

import { Search, Zap } from "lucide-react";
import { NotificationList } from "@/components/app/notification-bell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useStoredPulse } from "@/components/brand/events";
import { Hotbar } from "@/components/brand/hotbar";
import { Shulker } from "@/components/brand/shulker";
import { CaptureForm } from "@/components/capture/capture-dialog";
import { InboxEmpty } from "@/components/inbox/empty-state";
import { ActionHint, ItemCard, ItemListSkeleton, ProcessingLine } from "@/components/inbox/item-views";
import { SourceIcon } from "@/components/inbox/source-icon";
import { greeting, relativeTime } from "@/lib/client/format";
import { useLocale, useT } from "@/lib/i18n/client";
import { useClientValue } from "@/lib/client/use-client-value";
import { useHome, useQueueNudge, type HomeData } from "@/lib/client/queries";
import type { ItemSummary } from "@/lib/items/types";

function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  const t = useT();
  return (
    <div className="flex items-baseline justify-between px-1 pb-2">
      <h2 className="text-[13.5px] font-medium text-muted-foreground">{t(title)}</h2>
      {href && (
        <Link href={href} className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          {t(linkLabel ?? "View all")}
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

function statusSentence(data: HomeData, t: ReturnType<typeof useT>): string {
  const { savedToday, unread, processing, total } = data.stats;
  if (total === 0) return t("Nothing saved yet. Paste your first link below.");
  const parts = [
    savedToday > 0 ? t(savedToday === 1 ? "You saved {n} thing today." : "You saved {n} things today.", { n: savedToday }) : t("{n} items in your inbox.", { n: total }),
    unread > 0 ? t("{n} still unread.", { n: unread }) : t("Everything's been read."),
  ];
  if (data.stats.appliedThisWeek > 0) parts.push(t("{n} applied this week.", { n: data.stats.appliedThisWeek }));
  if (processing > 0) parts.push(t("{n} being understood right now.", { n: processing }));
  return parts.join(" ");
}

/** The mascot opens up while you're typing into it and gulps down whatever you save. */
function HomeMascot({ listening }: { listening: boolean }) {
  const t = useT();
  const stored = useStoredPulse(1100);
  return (
    <div className="relative ml-auto w-[44px] shrink-0 sm:ml-0 sm:w-[76px]">
      {stored && (
        <span aria-hidden className="item-drop absolute -top-2 left-1/2 -ml-[7px] size-[14px] rounded-[2px] bg-[var(--px-glow)] shadow-[inset_-2px_-2px_0_var(--px-head-shade)]" />
      )}
      <Shulker mood={stored || listening ? "open" : "peek"} idle={!listening && !stored} size={76} className="h-auto w-full" title={t("Shulker")} />
    </div>
  );
}

export function HomeView() {
  const { data, isLoading, isError, error, refetch } = useHome();
  const router = useRouter();
  const hello = useClientValue(greeting, "Hello.");
  const t = useT();
  const locale = useLocale();
  const [listening, setListening] = useState(false);
  useQueueNudge(Boolean(data?.stats.processing));

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <header className="flex flex-row-reverse items-start justify-end gap-5 pb-8 sm:flex-row sm:items-end sm:justify-start sm:gap-7">
        <HomeMascot listening={listening} />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[15px] text-muted-foreground">{t(hello)}</p>
          <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[34px]">
            {t("Toss it in the shulker box. It sorts itself.")}
          </h1>
          <p className="min-h-6 text-[15px] text-muted-foreground" aria-live="polite">
            {data ? statusSentence(data, t) : " "}
          </p>
        </div>
      </header>

      <div
        className="mb-10 overflow-hidden rounded-xl border bg-card shadow-xs focus-within:border-signal/40"
        onFocus={() => setListening(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setListening(false)}
      >
        <CaptureForm mode="link" autoFocus={false} rows={2} onDone={() => void refetch()} />
      </div>

      {data && data.stats.total > 0 && (
        <div className="mb-10">
          <Hotbar items={data.recent} total={data.stats.total} />
        </div>
      )}

      {isLoading ? (
        <ItemListSkeleton rows={4} />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          {error.message}{" "}
          <button type="button" className="text-signal hover:underline" onClick={() => refetch()}>
            {t("Try again")}
          </button>
        </p>
      ) : data!.stats.total === 0 ? (
        <InboxEmpty filtered={false} />
      ) : (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-10">
            {(data!.notifications.length > 0 || data!.waitingForYou.length > 0) && (
              <section aria-label={t("Waiting for you")} className="rounded-xl border">
                <h2 className="border-b px-4 py-2.5 text-[13.5px] font-medium">{t("Waiting for you")}</h2>
                {data!.notifications.length > 0 && <NotificationList notifications={data!.notifications} />}
                {data!.waitingForYou
                  .filter((i) => !data!.notifications.some((n) => n.itemId === i.id))
                  .map((item) => (
                    <Link key={item.id} href={`/items/${item.id}/setup`} className="flex items-center gap-3 border-t px-4 py-3 text-[14px] first:border-t-0 hover:bg-accent/60">
                      <Zap className="size-3.5 shrink-0 text-signal" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t(item.actionState === "needs_approval" ? "Review required" : "Your step")}</span>
                    </Link>
                  ))}
              </section>
            )}
            <section aria-label={t("Recently saved")}>
              <SectionHeader title="Recently saved" href="/inbox" />
              <div className="-mx-4 sm:-mx-5">
                {data!.recent.slice(0, 6).map((item) => (
                  <ItemCard key={item.id} item={item} onOpen={(id) => router.push(`/inbox?item=${id}`)} />
                ))}
              </div>
            </section>
            {data!.continueReading.length > 0 && (
              <section aria-label={t("Continue where you left off")}>
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
              <span className="flex-1">{t("Search by meaning…")}</span>
              <kbd className="font-mono text-[11px]">/</kbd>
            </Link>

            {data!.readyToApply.length > 0 && (
              <section aria-label={t("Ready to apply")}>
                <SectionHeader title="Ready to apply" href="/inbox?state=ready" />
                <div className="-mx-2 flex flex-col">
                  {data!.readyToApply.map((item) => (
                    <CompactLink key={item.id} item={item} meta={<ActionHint item={item} />} />
                  ))}
                </div>
              </section>
            )}

            {data!.recentlyApplied.length > 0 && (
              <section aria-label={t("Recently applied")}>
                <SectionHeader title="Recently applied" href="/activity" linkLabel="Activity" />
                <div className="-mx-2 flex flex-col">
                  {data!.recentlyApplied.map((item) => (
                    <CompactLink key={item.id} item={item} meta={item.appliedAt ? t("Applied {time}", { time: relativeTime(item.appliedAt, locale) }) : undefined} />
                  ))}
                </div>
              </section>
            )}

            {data!.highValue.length > 0 && (
              <section aria-label={t("Worth your time")}>
                <SectionHeader title="Worth your time" href="/inbox?state=high-value" />
                <div className="-mx-2 flex flex-col">
                  {data!.highValue.map((item) => (
                    <CompactLink key={item.id} item={item} meta={item.collection} />
                  ))}
                </div>
              </section>
            )}

            {data!.unread.length > 0 && (
              <section aria-label={t("Unread")}>
                <SectionHeader title="Unread" href="/inbox?state=unread" />
                <div className="-mx-2 flex flex-col">
                  {data!.unread.map((item) => (
                    <CompactLink
                      key={item.id}
                      item={item}
                      meta={item.processingStatus === "completed" ? t("Saved {time}", { time: relativeTime(item.savedAt, locale) }) : <ProcessingLine item={item} />}
                    />
                  ))}
                </div>
              </section>
            )}

            {data!.collections.length > 0 && (
              <section aria-label={t("Collections")}>
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
