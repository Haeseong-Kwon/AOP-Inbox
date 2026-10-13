"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SourceIcon } from "@/components/inbox/source-icon";
import { ItemListSkeleton } from "@/components/inbox/item-views";
import { apiGet, qs } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { useDebounced } from "@/lib/client/use-debounced";
import type { MatchReason, SearchHit } from "@/lib/search/hybrid";

const REASON_LABELS: Record<MatchReason, string> = {
  title: "Title match",
  note: "In your note",
  tag: "Tag",
  content: "Keyword",
  meaning: "Similar meaning",
  setup: "Setup history",
};

const EXAMPLES = ["AI agents running in parallel", "마케팅 자동화 아이디어", "onboarding UX", "pricing"];

export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(params.get("q") ?? "");
  const q = useDebounced(value.trim(), 300);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    router.replace(`${pathname}${qs({ q })}`, { scroll: false });
  }, [q, pathname, router]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["search", q],
    queryFn: ({ signal }) => apiGet<{ hits: SearchHit[] }>(`/api/search${qs({ q })}`, signal),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });
  const hits = q ? (data?.hits ?? []) : [];

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="flex h-12 items-center gap-3 rounded-xl border bg-card px-4 shadow-xs focus-within:border-signal/50"
      >
        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setValue("")}
          placeholder="Search by words or by meaning…"
          aria-label="Search your inbox"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none"
        />
        {value && (
          <button type="button" onClick={() => setValue("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </form>

      <div className="pt-6" aria-live="polite">
        {!q ? (
          <div className="flex flex-col gap-3 px-1 pt-4">
            <p className="text-sm text-muted-foreground">Describe what you remember — the topic, the idea, roughly what it showed. Try:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setValue(ex)}
                  className="rounded-md border px-2.5 py-1.5 text-[13px] text-foreground/85 transition-colors hover:bg-accent"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : isError ? (
          <p className="px-1 text-sm text-muted-foreground">{error.message}</p>
        ) : !data && isFetching ? (
          <ItemListSkeleton rows={4} />
        ) : hits.length === 0 ? (
          <div className="flex flex-col gap-2 px-1 pt-4">
            <p className="text-[15px] font-medium">No matches for “{q}”.</p>
            <p className="text-sm text-muted-foreground">
              Try fewer or different words, or{" "}
              <Link href={`/ask${qs({ q })}`} className="text-signal hover:underline">
                ask your inbox
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-xs text-muted-foreground">
              {hits.length} {hits.length === 1 ? "result" : "results"}
              {isFetching && " · updating"}
            </p>
            <ol className="-mx-3 flex flex-col">
              {hits.map(({ item, reasons }) => (
                <li key={item.id}>
                  <Link href={`/inbox?item=${item.id}`} className="flex flex-col gap-1.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-accent/70">
                    <span className="flex items-start gap-2.5">
                      <SourceIcon type={item.sourceType} className="mt-[3px] text-muted-foreground" />
                      <span className="text-[15px] leading-snug font-medium">{item.title}</span>
                    </span>
                    {item.summary && <span className="line-clamp-2 pl-6 text-[13.5px] leading-relaxed text-muted-foreground">{item.summary}</span>}
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
                      {reasons.map((r) => (
                        <span key={r} className={r === "meaning" ? "text-signal" : "text-foreground/70"}>
                          {REASON_LABELS[r]}
                        </span>
                      ))}
                      <span>{item.creatorName ?? item.domain}</span>
                      <span>{relativeTime(item.savedAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
