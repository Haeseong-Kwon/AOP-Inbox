"use client";

import { createContext, use, useMemo, useState, type ReactNode } from "react";

interface UIState {
  captureOpen: boolean;
  captureMode: "link" | "note";
  paletteOpen: boolean;
  openCapture: (mode?: "link" | "note") => void;
  setCaptureOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

const UIContext = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<"link" | "note">("link");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const value = useMemo<UIState>(
    () => ({
      captureOpen,
      captureMode,
      paletteOpen,
      openCapture: (mode = "link") => {
        setCaptureMode(mode);
        setPaletteOpen(false);
        setCaptureOpen(true);
      },
      setCaptureOpen,
      setPaletteOpen,
    }),
    [captureOpen, captureMode, paletteOpen],
  );
  return <UIContext value={value}>{children}</UIContext>;
}

export function useUI(): UIState {
  const ctx = use(UIContext);
  if (!ctx) throw new Error("useUI must be used inside UIProvider");
  return ctx;
}
