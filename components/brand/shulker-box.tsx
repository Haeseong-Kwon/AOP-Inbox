"use client";

import { cn } from "@/lib/utils";
import { Pixels } from "./pixels";

/** 셜커박스 — where everything you save goes. Original pixel art. */

const LID = [
  ".KKKKKKKKKKKKKK.",
  "KLLLLLLLLLLLLLLK",
  "KLSSSSSSSSSSSSDK",
  "KSSSSSSSSSSSSSDK",
  "KDDDDDDDDDDDDDDK",
  "KKKKKKKKKKKKKKKK",
];
const BODY = [
  "KSSSSSSSSSSSSSDK",
  "KSSSSKKKKKKSSSDK",
  "KSSSSKLLLLKSSSDK",
  "KSSSSKKKKKKSSSDK",
  "KSSSSSSSSSSSSSDK",
  "KSDSSSSSSSSSSDDK",
  "KSSSSSSSSSSSSSDK",
  "KSSSSSSSSSSSSSDK",
  "KDDDDDDDDDDDDDDK",
  ".KKKKKKKKKKKKKK.",
];
const GLOW = ["..GGGGGGGGGGGG.."];

export function ShulkerBox({ open = false, size = 20, className }: { open?: boolean; size?: number; className?: string }) {
  return (
    <svg viewBox="0 -4 16 20" width={size} height={(size * 20) / 16} shapeRendering="crispEdges" aria-hidden className={cn("shulker-box", className)} data-open={open || undefined}>
      {open && <Pixels map={GLOW} y={5} />}
      <Pixels map={BODY} y={6} />
      <g className="shulker-lid" style={{ transform: `translateY(${open ? -3 : 0}px)` }}>
        <Pixels map={LID} />
      </g>
    </svg>
  );
}
