"use client";

import { Check, CircleDashed, RotateCcw, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { relativeTime } from "@/lib/client/format";
import { useActivity } from "@/lib/client/queries";
import { useLocale, useT } from "@/lib/i18n/client";
import type { ActivityEntry } from "@/lib/execution/types";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "applied", label: "Applied" },
  { key: "you", label: "Needs you" },
  { key: "failed", label: "Failed" },
] as const;

function matches(e: ActivityEntry, f: (typeof FILTERS)[number]["key"]) {
  if (f === "applied") return e.status === "done";
  if (f === "you") return e.status === "awaiting_approval" || e.status === "needs_user_action";
  if (f === "failed") return e.status === "failed" || e.status === "expired";
  return true;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <Check className="size-4 text-signal" aria-hidden />;
  if (status === "failed" || status === "expired") return <X className="size-4 text-destructive" aria-hidden />;
  if (status === "rolled_back") return <RotateCcw className="size-4 text-muted-foreground" aria-hidden />;
  if (status === "cancelled") return <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

export function ActivityView() {
  const { data, isLoading, isError, error } = useActivity();
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const entries = (data?.entries ?? []).filter((e) => matches(e, filter));

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <header className="flex flex-col gap-1.5 pb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("Activity")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("What you set up from your saved items — when, what changed, and whether it worked.")}</p>
      </header>

      {data && (
        <p className="mb-8 text-[15px]">
          <span className="text-[22px] font-semibold tabular-nums">{data.stats.appliedThisWeek}</span>
          <span className="text-muted-foreground">{t(" applied this week · {n} in total", { n: data.stats.appliedTotal })}</span>
        </p>
      )}

      <div className="mb-4 flex gap-1" role="tablist" aria-label={t("Filter activity")}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn("h-7 rounded-md px-2.5 text-[13px]", filter === f.key ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}
          >
            {t(f.label)}
          </button>
        ))}
      </div>

      {isLoading && <div className="h-32 animate-pulse rounded-lg bg-muted/40" aria-hidden />}
      {isError && <p className="text-sm text-muted-foreground">{error.message}</p>}
      {data && entries.length === 0 && (
        <div className="flex flex-col gap-2 py-10">
          <p className="text-[15px] font-medium">{t("Nothing here yet.")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("When a saved item contains a setup — an install, an MCP server, a config change — you’ll review it and run it from the item. Everything that runs is recorded here.")}
          </p>
          <Link href="/inbox?state=ready" className="text-sm text-signal hover:underline">
            {t("See items ready to apply")}
          </Link>
        </div>
      )}

      <ol className="flex flex-col divide-y border-y">
        {entries.map((e) => (
          <li key={e.jobId}>
            <Link href={e.itemId ? `/items/${e.itemId}/setup` : "#"} className="flex gap-3 py-4 transition-colors hover:bg-accent/40 sm:px-2">
              <span className="pt-0.5">
                <StatusIcon status={e.status} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-[15px] font-medium">{e.itemTitle}</span>
                  <time className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.completedAt ?? e.createdAt, locale)}</time>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {t(e.statusLabel)}
                  {e.installed.length > 0 && ` · ${t("installed {names}", { names: e.installed.join(", ") })}`}
                  {e.changed.length > 0 && ` · ${t(e.changed.length === 1 ? "changed {n} file" : "changed {n} files", { n: e.changed.length })}`}
                  {e.verified > 0 && ` · ${t("{n} verified", { n: e.verified })}`}
                  {e.feedback && ` · ${t(e.feedback === "used" || e.feedback === "useful" ? "you used it" : e.feedback === "not_using" ? "not using it" : e.feedback.replace("_", " "))}`}
                  {!e.itemId && ` · ${t("original item deleted")}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {data && data.applied.length > 0 && filter === "all" && (
        <section className="mt-12">
          <h2 className="mb-3 text-[15px] font-semibold">{t("Applied knowledge")}</h2>
          <ul className="-mx-2 flex flex-col">
            {data.applied.map((a) => (
              <li key={a.id}>
                <Link href={`/inbox?item=${a.id}`} className="flex justify-between gap-4 rounded-md px-2 py-2 text-[14px] hover:bg-accent/60">
                  <span className="truncate">{a.title ?? t("Untitled")}</span>
                  {a.appliedAt && <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.appliedAt, locale)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
