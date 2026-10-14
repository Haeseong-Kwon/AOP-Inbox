"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useClientValue } from "@/lib/client/use-client-value";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { setLocale, useLocale, useT } from "@/lib/i18n/client";
import type { Locale, Vars } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Translated text with light markup: **bold**, `code`, [link] (to `href`). */
export function Rich({ text, vars, href }: { text: string; vars?: Vars; href?: string }) {
  const t = useT();
  const parts = t(text, vars).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\])/);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
        if (part.startsWith("`")) return <code key={i} className="font-mono text-[13px]">{part.slice(1, -1)}</code>;
        if (part.startsWith("[")) return <a key={i} href={href} className="text-signal hover:underline">{part.slice(1, -1)}</a>;
        return part;
      })}
    </>
  );
}

// Each language is named in itself, so it is never translated.
const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function LanguagePicker() {
  const t = useT();
  const locale = useLocale();
  return (
    <div role="radiogroup" aria-label={t("Language")} className="inline-flex rounded-lg border p-0.5">
      {LANGUAGES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={locale === value}
          lang={value}
          onClick={() => setLocale(value)}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-3 text-[13px] transition-colors",
            locale === value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const mounted = useClientValue(() => true, false);
  return (
    <div role="radiogroup" aria-label={t("Theme")} className="inline-flex rounded-lg border p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors",
              active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(label)}
          </button>
        );
      })}
    </div>
  );
}

export function SignOutButton() {
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops cached data after sign-out
        window.location.assign("/login");
      }}
    >
      <LogOut aria-hidden /> {t("Sign out")}
    </Button>
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallButton() {
  const t = useT();
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const installed = useMediaQuery("(display-mode: standalone)");
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (installed) return <p className="text-sm text-muted-foreground">{t("Installed on this device.")}</p>;
  if (!event) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("On iPhone: Share → Add to Home Screen. On Android or desktop Chrome: use the install icon in the address bar.")}
      </p>
    );
  }
  return (
    <Button variant="outline" onClick={() => void event.prompt()}>
      {t("Install AOP Inbox")}
    </Button>
  );
}
