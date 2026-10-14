"use client";

import { useEffect, useState } from "react";

/** "Something went into the shulker box" — lets the logo and mascot react to any save in the app. */
const STORED = "aop:stored";

export function emitStored() {
  window.dispatchEvent(new Event(STORED));
}

/** True for `ms` after every save. */
export function useStoredPulse(ms = 900): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handle = () => {
      setOn(true);
      clearTimeout(timer);
      timer = setTimeout(() => setOn(false), ms);
    };
    window.addEventListener(STORED, handle);
    return () => {
      window.removeEventListener(STORED, handle);
      clearTimeout(timer);
    };
  }, [ms]);
  return on;
}
