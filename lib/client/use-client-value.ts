"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** A value only known in the browser (time of day, mounted state). Server/hydration render uses `serverValue`. */
export function useClientValue<T>(getClient: () => T, serverValue: T): T {
  return useSyncExternalStore(noop, getClient, () => serverValue);
}

const STORAGE_EVENT = "aop:storage";

/** localStorage-backed string preference; safe when storage is unavailable. */
export function useStoredPreference(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(STORAGE_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(STORAGE_EVENT, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = (next: string) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // storage blocked — preference just won't persist
    }
    window.dispatchEvent(new Event(STORAGE_EVENT));
  };
  return [value, set];
}
