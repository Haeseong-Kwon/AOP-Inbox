"use client";

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeFromCookieHeader, translate, type Locale, type Vars } from "./index";

const EVENT = "aop:locale";

/** Current locale outside React (fetch helpers, toasts). */
export function currentLocale(): Locale {
  return typeof document === "undefined" ? DEFAULT_LOCALE : localeFromCookieHeader(document.cookie);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Server and hydration render use the default locale; the cookie wins right after. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale, () => DEFAULT_LOCALE);
}

export function setLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function useT() {
  const locale = useLocale();
  // Stable per locale, so effects that depend on `t` don't re-run every render.
  return useCallback((text: string, vars?: Vars) => translate(locale, text, vars), [locale]);
}

/** For server components: `<T>Inbox</T>`. */
export function T({ children, vars }: { children: string; vars?: Vars }) {
  return <>{useT()(children, vars)}</>;
}

/** Keeps <html lang> in sync with the chosen locale. */
export function LocaleSync(): ReactNode {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
