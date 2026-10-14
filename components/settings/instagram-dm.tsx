"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Shulker } from "@/components/brand/shulker";
import { Button } from "@/components/ui/button";
import { apiGet, apiSend } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { useLocale, useT } from "@/lib/i18n/client";
import type { InstagramLinkView } from "@/lib/instagram";
import { Rich } from "./settings-client";

const KEY = ["instagram-link"];

/** Save by DM'ing Reels to your own bot account (Meta's official messaging API). */
export function InstagramDmSetup() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // While a code is out, poll so the page flips to "linked" as soon as the DM arrives.
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => apiGet<InstagramLinkView>("/api/instagram/link"),
    refetchInterval: (q) => (code && !q.state.data?.linked && !q.state.data?.pending ? 3000 : false),
  });

  if (!data) return null;
  if (!data.configured) {
    return <p className="text-[14px] text-muted-foreground">{t("Not set up on this server yet. The owner connects a bot account once — see docs/instagram-dm.md.")}</p>;
  }
  const bot = `@${data.botUsername}`;
  const dmLink = `https://ig.me/m/${data.botUsername}`;

  const newCode = async () => {
    setBusy(true);
    try {
      setCode(await apiSend<{ code: string; expiresAt: string }>("/api/instagram/link", "POST"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    await apiSend("/api/instagram/link", "DELETE");
    setCode(null);
    await qc.invalidateQueries({ queryKey: KEY });
    toast(t("Disconnected. Messages to {bot} are no longer saved.", { bot }));
  };

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await apiSend("/api/instagram/link/confirm", approve ? "POST" : "DELETE");
      setCode(null);
      await qc.invalidateQueries({ queryKey: KEY });
      if (!approve) toast(t("Request declined. Nothing from that account will be saved."));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Someone DM'd this user's code: show who, and save nothing until they approve.
  if (data.pending) {
    const who = data.pending.username ? `@${data.pending.username}` : null;
    return (
      <div className="flex w-full flex-col gap-3 rounded-lg border border-signal/40 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Shulker mood="open" size={22} />
          <p className="text-[14px]">
            {who ? (
              <Rich text="**{who}** sent your code. Is this your Instagram account?" vars={{ who }} />
            ) : (
              t("Your code just arrived from Instagram, but the account name couldn't be read. Approve only if you sent it yourself just now.")
            )}
          </p>
        </div>
        <p className="text-[13px] text-muted-foreground">{t("Only approve your own account — whatever it sends to the bot will be saved here.")}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide(true)} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} {t("Yes, link it")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide(false)} disabled={busy}>
            {t("Not me")}
          </Button>
        </div>
      </div>
    );
  }

  if (data.linked) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
          <Shulker mood="peek" size={22} />
          <div className="min-w-0 flex-1 text-[14px]">
            <p className="font-medium">{data.username ? t("@{username} → {bot}", { username: data.username, bot }) : t("Connected to {bot}", { bot })}</p>
            <p className="text-[13px] text-muted-foreground">
              {data.lastMessageAt
                ? t("{n} messages · last {time}", { n: data.messageCount, time: relativeTime(data.lastMessageAt, locale) })
                : t("Linked {time} · nothing sent yet", { time: relativeTime(data.linkedAt!, locale) })}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={disconnect}>
            {t("Disconnect")}
          </Button>
        </div>
        <p className="text-[14px] leading-relaxed">
          <Rich text="In Instagram: **Share** → **Send** → pick **{bot}**. The bot replies when it's stored." vars={{ bot }} />
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-[14px] leading-relaxed">
        <Rich text="Share Reels to **{bot}** by DM, like sending them to a friend. Works from any phone or computer — no Shortcut needed." vars={{ bot }} />
      </p>
      {code ? (
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-[14px] leading-relaxed marker:text-muted-foreground">
          <li>
            <div className="flex flex-col gap-2">
              <span>{t("Copy this link code:")}</span>
              <div className="flex items-center gap-2 rounded-md bg-surface px-3 py-2">
                <code className="flex-1 font-mono text-[15px] tracking-wide">{code.code}</code>
                <button
                  type="button"
                  aria-label={t("Copy code")}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    navigator.clipboard.writeText(code.code).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? <Check className="size-3.5 text-signal" /> : <Copy className="size-3.5" />}
                </button>
              </div>
              <span className="text-xs text-muted-foreground">{t("Works once, for 15 minutes.")}</span>
            </div>
          </li>
          <li>
            <span className="inline-flex flex-wrap items-center gap-2">
              <Rich text="Send it to **{bot}** in an Instagram DM." vars={{ bot }} />
              <a href={dmLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-signal hover:underline">
                {t("Open DM")} <ExternalLink className="size-3" aria-hidden />
              </a>
            </span>
          </li>
          <li className="text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("Waiting for your message…")}
            </span>
          </li>
        </ol>
      ) : (
        <Button size="sm" className="w-fit" onClick={newCode} disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} {t("Connect Instagram")}
        </Button>
      )}
      <p className="text-[13px] text-muted-foreground">{t("AOP Inbox only sees messages you send to the bot. No Instagram password, and nothing is downloaded.")}</p>
    </div>
  );
}
