import { describe, expect, test } from "vitest";
import { localeFromCookieHeader, parseLocale, translate } from "@/lib/i18n";
import { ko } from "@/lib/i18n/ko";

describe("i18n", () => {
  test("Korean is the default; only an explicit en cookie switches to English", () => {
    expect(parseLocale(undefined)).toBe("ko");
    expect(parseLocale("fr")).toBe("ko");
    expect(localeFromCookieHeader(null)).toBe("ko");
    expect(localeFromCookieHeader("a=1; aop-locale=en; b=2")).toBe("en");
    expect(localeFromCookieHeader("xaop-locale=en")).toBe("ko");
  });

  test("English returns the key, unknown keys fall back to English, placeholders interpolate", () => {
    expect(translate("en", "Saved {time}", { time: "now" })).toBe("Saved now");
    expect(translate("ko", "No such key {n}", { n: 3 })).toBe("No such key 3");
    expect(translate("ko", "{missing} stays")).toBe("{missing} stays");
  });

  test("every Korean entry keeps the placeholders of its English key", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken = Object.entries(ko).filter(([en, k]) => names(en).join() !== names(k).join() || !k.trim());
    expect(broken).toEqual([]);
  });
});

describe("server templates", () => {
  test("a filled-in server string matches its catalog template", async () => {
    const { server } = await import("@/lib/i18n/ko/server");
    const key = Object.keys(server).find((k) => /^[^{]+\{\w+\}$/.test(k));
    if (!key) return;
    const filled = key.replace(/\{\w+\}$/, "XYZ");
    expect(translate("ko", filled)).toBe(server[key].replace(/\{\w+\}/, "XYZ"));
    expect(translate("en", filled)).toBe(filled);
  });
});
