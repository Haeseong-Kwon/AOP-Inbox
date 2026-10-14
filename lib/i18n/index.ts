import { ko } from "./ko";
import { server } from "./ko/server";

/**
 * gettext-style i18n: the English text is the key, so English needs no catalog and
 * server-provided English strings (status labels, errors) translate at display time.
 * Unknown keys fall back to English.
 */
export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ko";
export const LOCALE_COOKIE = "aop-locale";

export type Vars = Record<string, string | number>;

export function parseLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// Server strings arrive already filled in ("Runs code with python3"); match them
// against the server catalog's placeholder templates. Limited to that catalog so
// short UI templates like "Saved {time}" can't swallow unrelated text.
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const TEMPLATES = Object.keys(server)
  .filter((key) => /\{\w+\}/.test(key))
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const pattern = key.split(/\{\w+\}/).map(escape).join("(.+?)");
    return { key, names, re: new RegExp(`^${pattern}$`, "s") };
  });

function fromTemplate(text: string): string | undefined {
  for (const { key, names, re } of TEMPLATES) {
    const m = re.exec(text);
    if (m) return interpolate(server[key], Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return undefined;
}

export function translate(locale: Locale, text: string, vars?: Vars): string {
  if (locale === "en") return vars ? interpolate(text, vars) : text;
  const hit = ko[text];
  if (hit !== undefined) return vars ? interpolate(hit, vars) : hit;
  if (vars) return interpolate(text, vars);
  return fromTemplate(text) ?? text;
}

/** Locale from a raw Cookie header (route handlers). */
export function localeFromCookieHeader(header: string | null): Locale {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  return parseLocale(match?.[1]);
}
