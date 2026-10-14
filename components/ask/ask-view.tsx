"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Shulker } from "@/components/brand/shulker";
import { SourceIcon } from "@/components/inbox/source-icon";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { ItemSummary } from "@/lib/items/types";
import type { AskExecutionSource, AskSource } from "@/lib/search/ask";
import { cn } from "@/lib/utils";
import { AnswerText } from "./answer-text";

interface Exchange {
  id: number;
  question: string;
  answer: string;
  sources: AskSource[];
  executions: AskExecutionSource[];
  setups: ItemSummary[];
  status: "streaming" | "done" | "error";
  error?: string;
}

const SUGGESTIONS = [
  "내가 저장한 것 중 AI 코딩 에이전트 관련 아이디어를 정리해줘.",
  "Which saved items could I apply to AOP's onboarding?",
  "What marketing automation ideas have I saved?",
];

async function streamAsk(question: string, onEvent: (e: { type: string; [k: string]: unknown }) => void) {
  const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't reach your inbox. Try again.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
}

export function AskView() {
  const params = useSearchParams();
  const t = useT();
  const [input, setInput] = useState(params.get("q") ?? "");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = exchanges.some((e) => e.status === "streaming");

  const patch = (id: number, fn: (e: Exchange) => Exchange) => setExchanges((all) => all.map((e) => (e.id === id ? fn(e) : e)));

  const ask = async (question: string) => {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    const id = Date.now();
    setInput("");
    setExchanges((all) => [...all, { id, question: q, answer: "", sources: [], executions: [], setups: [], status: "streaming" }]);
    try {
      await streamAsk(q, (event) => {
        if (event.type === "sources") {
          patch(id, (e) => ({
            ...e,
            sources: event.sources as AskSource[],
            executions: (event.executions as AskExecutionSource[]) ?? [],
            setups: (event.setups as ItemSummary[]) ?? [],
          }));
        }
        else if (event.type === "delta") patch(id, (e) => ({ ...e, answer: e.answer + (event.text as string) }));
        else if (event.type === "error") patch(id, (e) => ({ ...e, status: "error", error: event.message as string }));
      });
      patch(id, (e) => (e.status === "streaming" ? { ...e, status: "done" } : e));
    } catch (error) {
      patch(id, (e) => ({ ...e, status: "error", error: (error as Error).message }));
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [exchanges.length]);

  const jumpToSource = (exchangeId: number, n: string) => {
    document.getElementById(`src-${exchangeId}-${n}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    document.getElementById(`src-${exchangeId}-${n}`)?.focus({ preventScroll: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-4 pt-8 sm:px-8 md:pt-14">
      <header className="flex flex-col gap-1.5 pb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("Ask Inbox")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("Answers come only from what you’ve saved, with sources you can open.")}</p>
      </header>

      <div className="flex flex-1 flex-col gap-12 pb-8">
        {exchanges.length === 0 && (
          <div className="flex flex-col gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(t(s))}
                className="rounded-lg border px-4 py-3 text-left text-[14.5px] text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-accent/50"
              >
                {t(s)}
              </button>
            ))}
          </div>
        )}

        {exchanges.map((ex) => (
          <section key={ex.id} aria-label={ex.question} className="flex flex-col gap-5">
            <h2 className="text-[17px] leading-snug font-semibold tracking-[-0.01em]">{ex.question}</h2>
            {ex.answer ? (
              <AnswerText text={ex.answer} onCite={(n) => jumpToSource(ex.id, n)} />
            ) : ex.status === "streaming" ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Shulker mood="think" size={14} /> {t("Reading your saved items…")}
              </p>
            ) : null}
            {ex.status === "error" && <p className="text-sm text-destructive">{t(ex.error ?? "")}</p>}

            {ex.status === "done" && ex.setups.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-[14px]">
                <span>
                  {t(ex.setups.length === 1 ? "{n} related setup found" : "{n} related setups found", { n: ex.setups.length })}
                </span>
                {ex.setups.slice(0, 3).map((s) => (
                  <Link key={s.id} href={`/items/${s.id}/setup`} className="text-[13px] text-signal hover:underline">
                    {t("Review “{title}”", { title: s.title.length > 32 ? `${s.title.slice(0, 30)}…` : s.title })}
                  </Link>
                ))}
              </div>
            )}

            {ex.executions.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-[13px] font-medium text-muted-foreground">{t("Setup history · {n}", { n: ex.executions.length })}</h3>
                <ol className="-mx-2 flex flex-col">
                  {ex.executions.map((e) => (
                    <li key={e.jobId}>
                      <Link
                        id={`src-${ex.id}-${e.label}`}
                        href={e.itemId ? `/items/${e.itemId}/setup` : "/activity"}
                        className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        <span className="w-6 shrink-0 text-center text-xs font-medium text-signal tabular-nums">{e.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[14px]">{e.itemTitle}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t(e.status)} {e.date}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {ex.sources.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-[13px] font-medium text-muted-foreground">{t("Sources · {n}", { n: ex.sources.length })}</h3>
                <ol className="-mx-2 flex flex-col">
                  {ex.sources.map(({ index, item }) => (
                    <li key={item.id}>
                      <Link
                        id={`src-${ex.id}-${index}`}
                        href={`/inbox?item=${item.id}`}
                        className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        <span className="w-5 shrink-0 text-center text-xs font-medium text-signal tabular-nums">{index}</span>
                        <SourceIcon type={item.sourceType} className="text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{item.title}</span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.collection}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 bg-gradient-to-t from-background from-70% to-transparent px-4 pt-6 pb-3 sm:-mx-8 sm:px-8 md:bottom-0 md:pb-5"
      >
        <div className={cn("flex items-end gap-2 rounded-xl border bg-card p-2 pl-4 shadow-sm focus-within:border-signal/50")}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            autoFocus
            aria-label={t("Ask a question about your saved items")}
            placeholder={t("Ask about anything you’ve saved…")}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none field-sizing-content"
          />
          <Button type="submit" size="icon" disabled={busy || input.trim().length < 2} aria-label={t("Ask")}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </div>
  );
}
