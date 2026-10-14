"use client";

import { useT } from "@/lib/i18n/client";

const SEGMENTS = 18;

/**
 * Minecraft's experience bar. Level = setups applied in total;
 * the bar fills with this week's applies (a week of 7 fills it).
 */
export function XpBar({ level, week }: { level: number; week: number }) {
  const t = useT();
  const filled = Math.min(SEGMENTS, Math.round((Math.min(week, 7) / 7) * SEGMENTS));
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-1" role="img" aria-label={t("Level {level} · {n} applied this week", { level, n: week })}>
      <span className="font-pixel mc-text-shadow text-[18px] leading-none text-[var(--mc-xp)]">{level}</span>
      <div className="grid h-[7px] w-full grid-cols-[repeat(18,1fr)] gap-px bg-black/70 p-px">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < filled ? "bg-[var(--mc-xp)]" : "bg-[#1f2a12]"} />
        ))}
      </div>
    </div>
  );
}

const ORBS = [-14, -6, 2, 9, 15];

/** A one-shot burst of XP orbs (decorative). */
export function XpBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {ORBS.map((dx, i) => (
        <span
          key={dx}
          className="xp-orb absolute size-[7px] rounded-full bg-[var(--mc-xp)] shadow-[0_0_6px_var(--mc-xp)]"
          style={{ ["--dx" as string]: `${dx}px`, animationDelay: `${i * 90}ms`, opacity: 0 }}
        />
      ))}
    </span>
  );
}
