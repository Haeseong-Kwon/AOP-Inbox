"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";

interface LoginFormProps {
  dev: { email: string; password: string } | null;
}

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm({ dev }: LoginFormProps) {
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(dev?.email ?? "");
  const [password, setPassword] = useState(dev?.password ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
        setError(
          res.status === 401
            ? "That email and password don't match."
            : (data?.message ?? "Couldn't sign you in. Try again."),
        );
        return;
      }
      window.location.href = safeNext(params.get("next"));
    } catch {
      setError("You're offline. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-[360px]">
      <Logo className="mb-6 size-8" />
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{mode === "signin" ? "Sign in to AOP Inbox" : "Create your account"}</h1>
      <p className="mt-1.5 mb-8 text-[15px] text-muted-foreground">Capture once. Understand automatically. Find anything later.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-lg border bg-surface px-3 text-[15px] font-normal outline-none focus:border-signal/60"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Password
          <input
            type="password"
            required
            minLength={10}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {mode === "signin" ? "First time here? " : "Already have an account? "}
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-foreground underline-offset-4 hover:underline">
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
      {dev && <p className="mt-10 text-xs text-muted-foreground">Development mode: the seeded account is filled in.</p>}
    </div>
  );
}
