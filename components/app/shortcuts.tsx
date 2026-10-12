"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUI } from "./ui-store";

/** True when a keystroke belongs to a text field or an open dialog, not to the app. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return Boolean(el.closest("[role=dialog],[role=menu],[role=listbox][data-slot=command-list]"));
}

export function GlobalShortcuts() {
  const { openCapture, setPaletteOpen, paletteOpen, captureOpen } = useUI();
  const router = useRouter();

  // PWA shortcut "/?capture=1" opens capture straight away.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("capture") === "1") {
      url.searchParams.delete("capture");
      window.history.replaceState(null, "", url);
      openCapture();
    }
  }, [openCapture]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e) || paletteOpen || captureOpen) return;
      if (e.key === "c") {
        e.preventDefault();
        openCapture();
      } else if (e.key === "/") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCapture, setPaletteOpen, paletteOpen, captureOpen, router]);

  return null;
}
