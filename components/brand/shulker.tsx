"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Pixels } from "./pixels";

/** 셜커 — the mascot. A shell that opens to show the little head inside. Original pixel art. */

const LID = [
  ".KKKKKKKKKKKKKK.",
  "KLLLLLLLLLLLLLLK",
  "KLSSSSSSSSSSSSDK",
  "KSSSDSSSSSSDSSDK",
  "KSSSSSSSSSSSSSDK",
  "KSSDSSSSSSSSDSDK",
  "KDDDDDDDDDDDDDDK",
  "KKKKKKKKKKKKKKKK",
];
const BASE = [
  "KLLLLLLLLLLLLLLK",
  "KSSSSSSSSSSSSSDK",
  "KSSSSDSSSSDSSSDK",
  "KSSSSSSSSSSSSSDK",
  "KSDSSSSSSSSSSDDK",
  "KSSSSSSSSSSSSSDK",
  "KDDDDDDDDDDDDDDK",
  ".KKKKKKKKKKKKKK.",
];
const HEAD = [
  "hHHHHHHHHh",
  "HHHHHHHHHH",
  "HEEHHHHEEH",
  "HEEHHHHEEH",
  "HHHHMMHHHH",
  "hHHHHHHHHh",
  "hhhhhhhhhh",
];
const HEAD_CLOSED_EYES = [...HEAD.slice(0, 2), "HHHHHHHHHH", "HEEHHHHEEH", ...HEAD.slice(4)];

export type ShulkerMood = "closed" | "peek" | "open" | "sleep";

/** How far the lid lifts, in sprite pixels. */
const LIFT: Record<ShulkerMood, number> = { closed: 0, sleep: 0, peek: 3, open: 5 };

export function Shulker({
  mood = "closed",
  size = 64,
  idle = false,
  hurt = false,
  className,
  title,
}: {
  mood?: ShulkerMood;
  size?: number;
  /** Peeks out every few seconds on its own, like shulkers do. */
  idle?: boolean;
  /** Minecraft damage flash. */
  hurt?: boolean;
  className?: string;
  title?: string;
}) {
  const idleMood = useIdlePeek(idle && (mood === "closed" || mood === "peek"), mood);
  const shown = idleMood ?? mood;
  const lift = LIFT[shown];
  return (
    <svg
      viewBox="0 -6 16 22"
      width={size}
      height={(size * 22) / 16}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shulker", hurt && "shulker-hurt", className)}
      data-mood={shown}
    >
      {title && <title>{title}</title>}
      <g className="shulker-head" style={{ transform: `translateY(${lift ? 0 : 1}px)` }}>
        <Pixels map={shown === "peek" || shown === "open" ? HEAD : HEAD_CLOSED_EYES} x={3} y={3} />
      </g>
      <Pixels map={BASE} y={8} />
      <g className="shulker-lid" style={{ transform: `translateY(${-lift}px)` }}>
        <Pixels map={LID} />
      </g>
      {shown === "sleep" && (
        <g className="shulker-zzz" fill="var(--px-light)">
          <rect x={13} y={-5} width={2} height={1} />
          <rect x={14} y={-4} width={1} height={1} />
          <rect x={13} y={-3} width={2} height={1} />
        </g>
      )}
    </svg>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Every few seconds a closed shulker peeks and a peeking one opens wide; null in between. Never with reduced motion. */
function useIdlePeek(enabled: boolean, base: ShulkerMood): ShulkerMood | null {
  const [peek, setPeek] = useState<ShulkerMood | null>(null);
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setPeek(base === "peek" ? (Math.random() < 0.5 ? "open" : "closed") : Math.random() < 0.3 ? "open" : "peek");
        timer = setTimeout(() => {
          setPeek(null);
          schedule();
        }, 1400);
      }, 3500 + Math.random() * 5000);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setPeek(null);
    };
  }, [enabled, base]);
  return enabled ? peek : null;
}
