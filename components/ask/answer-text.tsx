"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Tiny, safe Markdown subset for LLM answers: paragraphs, bullets, numbered
 * lists, headings, **bold**, _italic_, `code`, and [n] citations. Builds React
 * nodes only — no HTML injection.
 */

function inline(text: string, onCite: (n: number) => void, key: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_\s][^_]*_|`[^`]+`|\[\d{1,2}\])/g);
  return parts.map((part, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(part)) return <em key={k} className="text-muted-foreground">{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const cite = part.match(/^\[(\d{1,2})\]$/);
    if (cite) {
      const n = Number(cite[1]);
      return (
        <button
          key={k}
          type="button"
          onClick={() => onCite(n)}
          aria-label={`Source ${n}`}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded bg-signal-soft px-1 align-middle font-sans text-[11px] font-medium text-signal tabular-nums hover:bg-signal hover:text-primary-foreground"
        >
          {n}
        </button>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={list.ordered ? "flex list-decimal flex-col gap-1.5 pl-5" : "flex flex-col gap-1.5"}>
        {list.items.map((it, i) => (
          <li key={i} className={list!.ordered ? "pl-1" : "flex gap-3"}>
            {!list!.ordered && <span className="mt-[0.7em] size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />}
            <span>{inline(it, onCite, `li${blocks.length}-${i}`)}</span>
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push(<h3 key={i} className="pt-2 text-[15px] font-semibold">{inline(heading[1], onCite, `h${i}`)}</h3>);
    else blocks.push(<p key={i}>{inline(line, onCite, `p${i}`)}</p>);
  });
  flush();
  return <div className="flex flex-col gap-3 text-[15.5px] leading-[1.7]">{blocks}</div>;
}
