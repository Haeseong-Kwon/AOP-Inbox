"use client";

import { Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/lib/client/api";
import type { CaptureResponse } from "@/lib/items/types";

type State = { kind: "saving" } | { kind: "saved"; res: CaptureResponse } | { kind: "error"; message: string };

export function ShareCapture() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ kind: "saving" });
  const started = useRef(false);
  const url = params.get("url")?.trim();
  const text = params.get("text")?.trim();
  const title = params.get("title")?.trim();
  // Android puts the link in `text` more often than in `url`.
  const input = url || text || "";

  useEffect(() => {
    if (started.current || !input) return;
    started.current = true;
    const note = url && text && !text.includes(url) ? text : undefined;
    apiSend<CaptureResponse>("/api/capture", "POST", { input, note, title: title || undefined })
      .then((res) => setState({ kind: "saved", res }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, [input, url, text, title]);

  if (!input || state.kind === "error") {
    return (
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <p className="text-[17px] font-medium">{input ? "Couldn't save this." : "Nothing to save."}</p>
        <p className="text-sm text-muted-foreground">{state.kind === "error" ? state.message : "The share didn't include a link or text."}</p>
        <Button asChild variant="outline">
          <Link href="/">Open AOP Inbox</Link>
        </Button>
      </div>
    );
  }
  if (state.kind === "saving") {
    return (
      <p className="inline-flex items-center gap-3 text-[17px]" role="status">
        <Loader2 className="size-5 animate-spin text-signal" aria-hidden /> Saving…
      </p>
    );
  }
  const { item, duplicate } = state.res;
  return (
    <div className="flex max-w-sm flex-col items-center gap-5 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-signal-soft animate-in zoom-in-50 fade-in-0 duration-300">
        <Check className="size-7 text-signal" aria-hidden />
      </span>
      <div>
        <p className="text-[22px] font-semibold tracking-[-0.015em]">{duplicate ? "Already in your Inbox" : "Saved"}</p>
        <p className="mt-1.5 line-clamp-2 text-[15px] text-muted-foreground">{item.title}</p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/inbox?item=${item.id}`}>Open</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Done</Link>
        </Button>
      </div>
    </div>
  );
}
