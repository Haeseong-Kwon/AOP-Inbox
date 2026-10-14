"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Loader2, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiGet, apiSend } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import type { CaptureTokenView } from "@/lib/capture-tokens";
import { useClientValue } from "@/lib/client/use-client-value";
import { useLocale, useT } from "@/lib/i18n/client";
import { Rich } from "./settings-client";

function Value({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{value}</code>
        <button
          type="button"
          aria-label={t("Copy {label}", { label })}
          onClick={() =>
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              if (secret) toast(t("Copied — paste it into the Shortcut now; it won't be shown again."));
            })
          }
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-signal" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Guide({ token, server }: { token: string; server: string }) {
  const t = useT();
  const endpoint = `${server.replace(/\/+$/, "")}/api/capture`;
  return (
    <ol className="flex list-decimal flex-col gap-4 pl-5 text-[14px] leading-relaxed marker:text-muted-foreground">
      <li>
        <Rich text="Open the **Shortcuts** app → **+** → name it **Save to AOP Inbox**." />
      </li>
      <li>
        <Rich text="Tap **ⓘ** (Details) → turn on **Show in Share Sheet**, and set share sheet types to **URLs** and **Text**." />
      </li>
      <li>
        <div className="flex flex-col gap-2">
        <span>
          <Rich text="Add the action **Get Contents of URL** and set it up:" />
        </span>
        <Value label="URL" value={endpoint} />
        <span className="text-[13px] text-muted-foreground">
          <Rich text="Method **POST** · Headers: add one header" />
        </span>
        <Value label={t("Header key")} value="Authorization" />
        <Value label={t("Header value")} value={`Bearer ${token}`} secret />
        <span className="text-[13px] text-muted-foreground">
          <Rich text="Request Body **JSON** → add a **Text** field with key `input` and value **Shortcut Input** (tap the field and choose the variable)." />
        </span>
        </div>
      </li>
      <li>
        <Rich text="Add **Get Dictionary Value** → get value for `message` in **Contents of URL**." />
      </li>
      <li>
        <Rich text="Add **Show Notification** with **Dictionary Value**. Done." />
      </li>
      <li>
        <Rich text="In Instagram: **Share** → scroll the app row to **More** → pick **Save to AOP Inbox** (tap **Edit Actions** to add it to Favorites so it’s one tap next time). You’ll see “Saved to AOP Inbox” without leaving Instagram." />
      </li>
    </ol>
  );
}

export function ShortcutSetup() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["capture-tokens"], queryFn: ({ signal }) => apiGet<{ tokens: CaptureTokenView[] }>("/api/capture-tokens", signal) });
  const [fresh, setFresh] = useState<{ token: string; view: CaptureTokenView } | null>(null);
  const [creating, setCreating] = useState(false);
  // Origin is browser-only; reading it via useSyncExternalStore keeps SSR and hydration in agreement.
  const origin = useClientValue(() => window.location.origin, "");
  const [override, setOverride] = useState<string | null>(null);
  const server = override ?? origin;
  const [test, setTest] = useState<"idle" | "pending" | "ok" | "fail">("idle");
  const unreachable = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(server);
  const insecure = server.startsWith("http://") && !unreachable;

  const create = async () => {
    setCreating(true);
    try {
      const res = await apiSend<{ token: string; view: CaptureTokenView }>("/api/capture-tokens", "POST", { name: "iPhone Shortcut" });
      setFresh(res);
      setTest("idle");
      void qc.invalidateQueries({ queryKey: ["capture-tokens"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const runTest = async () => {
    if (!fresh) return;
    setTest("pending");
    try {
      const res = await fetch("/api/capture", { headers: { authorization: `Bearer ${fresh.token}` } });
      setTest(res.ok ? "ok" : "fail");
    } catch {
      setTest("fail");
    }
  };

  const revoke = async (id: string) => {
    await apiSend(`/api/capture-tokens/${id}`, "DELETE").catch((e: Error) => toast.error(e.message));
    if (fresh?.view.id === id) setFresh(null);
    void qc.invalidateQueries({ queryKey: ["capture-tokens"] });
    toast(t("Token revoked — Shortcuts using it stop working"));
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <p className="text-[14px] leading-relaxed">
        <Rich text="Save a Reel straight from Instagram’s share sheet on iPhone (or Mac), without opening AOP Inbox. It uses a **capture-only token**: it can save items and nothing else, and you can revoke it any time." />
      </p>

      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-muted-foreground">{t("Address your iPhone uses to reach AOP Inbox")}</span>
        <input
          value={server}
          onChange={(e) => setOverride(e.target.value.trim())}
          className="h-9 rounded-md border bg-surface px-3 font-mono text-[13px] outline-none focus:border-signal/50"
          aria-label={t("Server address")}
        />
      </label>
      {unreachable && (
        <p className="flex gap-2 rounded-md border px-3 py-2 text-[13px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {t("Your iPhone can’t reach “localhost”. Use the HTTPS address where AOP Inbox is deployed (or a tunnel such as Tailscale / Cloudflare Tunnel).")}
        </p>
      )}
      {insecure && (
        <p className="flex gap-2 rounded-md border px-3 py-2 text-[13px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {t("Plain http sends the token unencrypted over your network. Prefer an https address.")}
        </p>
      )}

      {fresh ? (
        <div className="flex flex-col gap-5 rounded-lg border px-4 py-4">
          <p className="text-[13px] text-muted-foreground">{t("This token is shown only now. If you lose it, revoke it and create a new one.")}</p>
          <Guide token={fresh.token} server={server} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={runTest} disabled={test === "pending"}>
              {test === "pending" && <Loader2 className="animate-spin" aria-hidden />} {t("Test the token")}
            </Button>
            {test === "ok" && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-signal">
                <Check className="size-3.5" aria-hidden /> {t("Token works")}
              </span>
            )}
            {test === "fail" && <span className="text-[13px] text-destructive">{t("The token didn’t work. Create a new one.")}</span>}
          </div>
          <p className="text-[13px] text-muted-foreground">
            <Rich text="Then try it for real: share any Reel to **Save to AOP Inbox** — it appears at the top of your Inbox within a second." />
          </p>
        </div>
      ) : (
        <Button className="w-fit" onClick={create} disabled={creating}>
          {creating ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />} {t("Set up iPhone Shortcut")}
        </Button>
      )}

      {data && data.tokens.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] text-muted-foreground">{t("Capture tokens")}</p>
          <ul className="flex flex-col divide-y border-y">
            {data.tokens.map((tok) => (
              <li key={tok.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                <span className="min-w-0">
                  <span className="block truncate">
                    {tok.name} <span className="font-mono text-[12px] text-muted-foreground">{tok.prefix}…</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tok.lastUsedAt
                      ? t("Last used {time} · {count} saves", { time: relativeTime(tok.lastUsedAt, locale), count: tok.useCount })
                      : t("Created {time} · not used yet", { time: relativeTime(tok.createdAt, locale) })}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => revoke(tok.id)}>
                  {t("Revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
