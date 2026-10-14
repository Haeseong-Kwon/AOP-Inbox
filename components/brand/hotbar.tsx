"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { instagramShortcode, SourceTile } from "@/components/inbox/item-views";
import { SourceIcon } from "@/components/inbox/source-icon";
import { kindLabel } from "@/lib/client/format";
import { useT } from "@/lib/i18n/client";
import type { ItemSummary } from "@/lib/items/types";
import { cn } from "@/lib/utils";

const SLOTS = 9;

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * The newest nine things in your shulker box, as a Minecraft hotbar.
 * Keys 1–9 open a slot, like switching hotbar slots in the game.
 */
export function Hotbar({ items, total }: { items: ItemSummary[]; total: number }) {
  const t = useT();
  const router = useRouter();
  const slots = Array.from({ length: SLOTS }, (_, i) => items[i] ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !/^[1-9]$/.test(e.key)) return;
      const item = items[Number(e.key) - 1];
      if (item) router.push(`/inbox?item=${item.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, router]);

  return (
    <section aria-label={t("Hotbar")} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[13.5px] font-medium text-muted-foreground">{t("In your shulker box")}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{t("{n} items", { n: total })}</span>
      </div>
      <ol className="grid w-fit grid-cols-9 gap-0.5 rounded-[2px] p-0.5 mc-slot-frame">
        {slots.map((item, i) => (
          <li key={item?.id ?? `empty-${i}`} className="relative">
            {item ? <Slot item={item} index={i} /> : <span className="mc-slot block size-9 sm:size-11" />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Slot({ item, index }: { item: ItemSummary; index: number }) {
  const t = useT();
  const initial = (item.title || item.domain || "?").trim().charAt(0).toUpperCase();
  return (
    <Link
      href={`/inbox?item=${item.id}`}
      aria-label={item.title}
      className="group mc-slot relative flex size-9 items-center justify-center outline-none sm:size-11"
    >
      {item.thumbnailUrl || instagramShortcode(item) ? (
        // The item itself sits in the slot, like an item icon.
        <SourceTile item={item} className="absolute inset-[3px] rounded-none border-0" />
      ) : (
        <span className="font-reading text-[17px] leading-none text-foreground/85 sm:text-[20px]">{initial}</span>
      )}
      <SourceIcon type={item.sourceType} className="absolute right-0.5 bottom-0.5 size-2.5 text-muted-foreground sm:size-3" />
      <span className="absolute top-0 left-0.5 font-pixel text-[8px] text-muted-foreground/80">{index + 1}</span>
      {/* hover/focus highlight, like a selected slot */}
      <span className="pointer-events-none absolute inset-0 hidden bg-white/18 group-hover:block group-focus-visible:block" />
      <span
        role="tooltip"
        className={cn(
          "mc-tooltip pointer-events-none absolute bottom-full z-30 mb-2 hidden w-max max-w-[240px] px-2 py-1.5 text-left",
          // keep edge slots' tooltips on screen
          index < 3 ? "left-0" : index > 5 ? "right-0" : "left-1/2 -translate-x-1/2",
          "group-hover:block group-focus-visible:block",
        )}
      >
        <span className="mc-text-shadow block text-[13px] leading-snug text-white">{item.title}</span>
        <span className="mc-text-shadow block text-[11.5px] text-[#aaaaaa]">{t(kindLabel(item.sourceType, item.contentKind))}{item.domain ? ` · ${item.domain}` : ""}</span>
        {item.collection && <span className="mc-text-shadow block text-[11.5px] text-[#55ffff]">{t(item.collection)}</span>}
      </span>
    </Link>
  );
}
