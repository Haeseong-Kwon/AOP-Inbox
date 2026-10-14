"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
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
// Eyes are drawn separately so they can blink and look around.
const HEAD = [
  "hHHHHHHHHh",
  "HHHHHHHHHH",
  "HHHHHHHHHH",
  "HHHHHHHHHH",
  "HHHHMMHHHH",
  "hHHHHHHHHh",
  "hhhhhhhhhh",
];
const HEART = ["RR.RR", "RRRRR", ".RRR.", "..R.."];

/**
 * - closed / peek / open: how far the shell is open
 * - sleep: shut, with Zzz
 * - think: the lid chatters while the eyes scan (working on something)
 * - happy: wide open, hopping, hearts (something just landed)
 * - no: shut, shakes its shell (nothing found / failed)
 */
export type ShulkerMood = "closed" | "peek" | "open" | "sleep" | "think" | "happy" | "no";

/** How far the lid lifts, in sprite pixels. */
const LIFT: Record<ShulkerMood, number> = { closed: 0, sleep: 0, no: 0, think: 0, peek: 3, open: 5, happy: 5 };
const EYES_OPEN = new Set<ShulkerMood>(["peek", "open", "think", "happy"]);

export function Shulker({
  mood = "closed",
  size = 64,
  idle = false,
  watch = false,
  pokeable = false,
  hurt = 0,
  className,
  title,
}: {
  mood?: ShulkerMood;
  size?: number;
  /** Peeks out every few seconds on its own, like shulkers do. */
  idle?: boolean;
  /** Eyes follow the pointer. */
  watch?: boolean;
  /** Clicking it makes it flinch shut — and poke it enough and it teleports away. */
  pokeable?: boolean;
  /** Bump to play Minecraft's damage flash. */
  hurt?: number;
  className?: string;
  title?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rigRef = useRef<SVGGElement>(null);
  const [pokeMood, poke] = usePoke(svgRef, rigRef);
  const idleMood = useIdlePeek(idle && !pokeMood && (mood === "closed" || mood === "peek"), mood);
  const shown = pokeMood ?? idleMood ?? mood;
  const look = useLook(svgRef, watch && EYES_OPEN.has(shown));
  useHurtFlash(svgRef, hurt);

  const lift = LIFT[shown];
  const eyesOpen = EYES_OPEN.has(shown);
  const headDown = lift === 0 && shown !== "think";
  return (
    <svg
      ref={svgRef}
      viewBox="0 -6 16 22"
      width={size}
      height={(size * 22) / 16}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shulker", pokeable && "cursor-pointer", className)}
      data-mood={shown}
      onClick={pokeable ? poke : undefined}
    >
      {title && <title>{title}</title>}
      <g ref={rigRef} className="shulker-rig">
        <g className="shulker-head" style={{ transform: `translateY(${headDown ? 1 : 0}px)` }}>
          <Pixels map={HEAD} x={3} y={3} />
          <g style={{ transform: `translateX(${look}px)` }}>
            <g className={eyesOpen ? "shulker-eyes" : undefined} fill="var(--px-eye)">
              <rect x={4} y={eyesOpen ? 5 : 6} width={2} height={eyesOpen ? 2 : 1} />
              <rect x={10} y={eyesOpen ? 5 : 6} width={2} height={eyesOpen ? 2 : 1} />
            </g>
          </g>
        </g>
        <Pixels map={BASE} y={8} />
        <g className="shulker-lid" style={{ transform: `translateY(${-lift}px)` }}>
          <Pixels map={LID} />
        </g>
      </g>
      {shown === "sleep" && (
        <g className="shulker-zzz" fill="var(--px-light)">
          <rect x={13} y={-5} width={2} height={1} />
          <rect x={14} y={-4} width={1} height={1} />
          <rect x={13} y={-3} width={2} height={1} />
        </g>
      )}
      {shown === "happy" && (
        <>
          <g className="shulker-heart">
            <Pixels map={HEART} x={1} y={-11} />
          </g>
          <g className="shulker-heart" style={{ animationDelay: "450ms" }}>
            <Pixels map={HEART} x={10} y={-9} />
          </g>
        </>
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

/** -1 / 0 / 1: which way the pointer is, relative to the shulker. */
function useLook(ref: RefObject<SVGSVGElement | null>, enabled: boolean): number {
  const [look, setLook] = useState(0);
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2);
        setLook(Math.abs(dx) < r.width ? 0 : Math.sign(dx));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [enabled, ref]);
  return enabled ? look : 0;
}

const HURT_FRAMES: Keyframe[] = [
  { filter: "sepia(1) saturate(6) hue-rotate(-50deg) brightness(0.9)", transform: "translateX(-1px)" },
  { filter: "sepia(1) saturate(6) hue-rotate(-50deg) brightness(0.9)", transform: "translateX(1px)", offset: 0.3 },
  { filter: "sepia(1) saturate(6) hue-rotate(-50deg) brightness(0.9)", transform: "translateX(-1px)", offset: 0.6 },
  { filter: "none", transform: "none" },
];

// Minecraft moves in ticks: hold each frame, then jump.
const ticked = (frames: Keyframe[]) => frames.map((f) => ({ ...f, easing: "steps(1, end)" }));

function flash(svg: SVGSVGElement | null) {
  if (svg && !reducedMotion()) svg.animate(ticked(HURT_FRAMES), { duration: 450 });
}

function useHurtFlash(ref: RefObject<SVGSVGElement | null>, hurt: number) {
  useEffect(() => {
    if (hurt > 0) flash(ref.current);
  }, [hurt, ref]);
}

// Shulkers teleport when they're hurt; here, after a few quick pokes.
const TELEPORT_FRAMES: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 0, transform: "translateY(-2px)", offset: 0.2 },
  { opacity: 0, transform: "translateX(5px)", offset: 0.5 },
  { opacity: 1, transform: "translateX(5px)", offset: 0.62 },
  { opacity: 1, transform: "translateX(5px)", offset: 0.8 },
  { opacity: 0, transform: "translateX(5px)", offset: 0.84 },
  { opacity: 0, transform: "none", offset: 0.9 },
  { opacity: 1, transform: "none" },
];
const POKES_TO_TELEPORT = 4;
const POKE_WINDOW_MS = 2500;

/** A poke: flinch and slam shut, then peek out warily for a moment (this also wakes a sleeping one). */
function usePoke(svgRef: RefObject<SVGSVGElement | null>, rigRef: RefObject<SVGGElement | null>): [ShulkerMood | null, () => void] {
  const [mood, setMood] = useState<ShulkerMood | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pokes = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const poke = () => {
    flash(svgRef.current);
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < POKE_WINDOW_MS), now];
    if (pokes.current.length >= POKES_TO_TELEPORT && !reducedMotion()) {
      pokes.current = [];
      rigRef.current?.animate(ticked(TELEPORT_FRAMES), { duration: 1100 });
    }
    timers.current.forEach(clearTimeout);
    setMood("closed");
    timers.current = [setTimeout(() => setMood("peek"), 700), setTimeout(() => setMood(null), 3200)];
  };
  return [mood, poke];
}
