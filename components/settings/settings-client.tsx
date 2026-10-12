"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useClientValue } from "@/lib/client/use-client-value";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useClientValue(() => true, false);
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border p-0.5">
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
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function SignOutButton() {
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
      <LogOut aria-hidden /> Sign out
    </Button>
  );
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallButton() {
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
  if (installed) return <p className="text-sm text-muted-foreground">Installed on this device.</p>;
  if (!event) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        On iPhone: Share → Add to Home Screen. On Android or desktop Chrome: use the install icon in the address bar.
      </p>
    );
  }
  return (
    <Button variant="outline" onClick={() => void event.prompt()}>
      Install AOP Inbox
    </Button>
  );
}
