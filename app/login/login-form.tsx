"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Shulker, type ShulkerMood } from "@/components/brand/shulker";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

interface LoginFormProps {
  dev: { email: string; password: string } | null;
}

/** Only same-origin paths; resolves tricks like "/\\evil.com" or "//evil.com" before comparing. */
export function safeNext(next: string | null, origin: string): string {
  if (!next) return "/";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/";
    // "/.//evil.com" resolves to pathname "//evil.com" — protocol-relative once assigned. Collapse it.
    return `/${url.pathname.replace(/^\/+/, "")}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function LoginForm({ dev }: LoginFormProps) {
  const t = useT();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(dev?.email ?? "");
  const [password, setPassword] = useState(dev?.password ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The shulker peeks at your email, shuts its shell while you type a password, and flinches on a wrong one.
  const [focus, setFocus] = useState<"email" | "password" | null>(null);
  const [hurt, setHurt] = useState(0);
  const mood: ShulkerMood = pending ? "think" : focus === "password" ? "closed" : focus === "email" ? "peek" : "closed";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const path = mode === "signin" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email";
    const body = mode === "signin" ? { email, password } : { email, password, name: email.split("@")[0] };
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setHurt((n) => n + 1);
        setError(
          res.status === 401
            ? t("That email and password don't match.")
            : t(data?.message ?? "Couldn't sign you in. Try again."),
        );
        return;
      }
      window.location.href = safeNext(params.get("next"), window.location.origin);
    } catch {
      setError(t("You're offline. Check your connection and try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-[360px]">
      <Shulker mood={mood} idle={!focus && !pending} hurt={hurt} watch pokeable size={44} className="mb-6" title={t("Shulker")} />
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{mode === "signin" ? t("Sign in to AOP Inbox") : t("Create your account")}</h1>
      <p className="mt-1.5 mb-8 text-[15px] text-muted-foreground">{t("Capture once. Understand automatically. Find anything later.")}</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {t("Email")}
          <input
            type="email"
            required
            autoComplete="email"
            onFocus={() => setFocus("email")}
            onBlur={() => setFocus(null)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-lg border bg-surface px-3 text-[15px] font-normal outline-none focus:border-signal/60"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {t("Password")}
          <input
            type="password"
            required
            minLength={10}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            onFocus={() => setFocus("password")}
            onBlur={() => setFocus(null)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg border bg-surface px-3 text-[15px] font-normal outline-none focus:border-signal/60"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-2 h-10" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {mode === "signin" ? t("Sign in") : t("Create account")}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {mode === "signin" ? t("First time here?") : t("Already have an account?")}{" "}
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-foreground underline-offset-4 hover:underline">
          {mode === "signin" ? t("Create an account") : t("Sign in")}
        </button>
      </p>
      {dev && <p className="mt-10 text-xs text-muted-foreground">{t("Development mode: the seeded account is filled in.")}</p>}
    </div>
  );
}
