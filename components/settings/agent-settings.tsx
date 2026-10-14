"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Laptop, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiSend } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { useDevices } from "@/lib/client/queries";
import type { DeviceView } from "@/lib/execution/types";
import { useLocale, useT } from "@/lib/i18n/client";
import { Rich } from "./settings-client";

function Copyable({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{text}</code>
      <button type="button" aria-label={t("Copy")} onClick={() => navigator.clipboard.writeText(text).then(() => toast(t("Copied")))} className="text-muted-foreground hover:text-foreground">
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

function PairDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const locale = useLocale();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    try {
      setCode(await apiSend<{ code: string; expiresAt: string }>("/api/devices/pair", "POST"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCode(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{t("Connect this Mac")}</DialogTitle>
        <DialogDescription>{t("The agent connects out to AOP Inbox; nothing on your Mac listens for connections. Its token is kept in your login Keychain.")}</DialogDescription>
        {!code ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px]">
            <li>{t("Install Node 22.13+ and Claude Code on the Mac.")}</li>
            <li>{t("Create a one-time code (valid for 10 minutes).")}</li>
            <li>{t("Run the command it shows in Terminal.")}</li>
          </ol>
        ) : (
          <div className="flex flex-col gap-3 text-[14px]">
            <p>
              {t("Code")} <span className="font-mono text-[16px] font-semibold tracking-wider">{code.code}</span>
              <span className="text-[13px] text-muted-foreground"> · {t("expires {time}", { time: relativeTime(code.expiresAt, locale) })}</span>
            </p>
            <p className="text-[13px] text-muted-foreground">{t("From the AOP Inbox repository:")}</p>
            <Copyable text={`pnpm --filter @aop-inbox/agent build && node packages/agent/dist/cli.js init --server ${origin} --code ${code.code}`} />
            <p className="text-[13px] text-muted-foreground">
              <Rich text="Then keep it running (or add `--launchd` to start at login):" />
            </p>
            <Copyable text="node packages/agent/dist/cli.js start" />
          </div>
        )}
        <DialogFooter>
          {!code ? (
            <Button onClick={create} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} {t("Create pairing code")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({ d }: { d: DeviceView }) {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const patch = async (body: Partial<Pick<DeviceView, "paused" | "autoRunLow">>) => {
    try {
      await apiSend(`/api/devices/${d.id}`, "PATCH", body);
      void qc.invalidateQueries({ queryKey: ["devices"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const revoke = async () => {
    await apiSend(`/api/devices/${d.id}`, "DELETE").catch((e: Error) => toast.error(e.message));
    setConfirm(false);
    void qc.invalidateQueries({ queryKey: ["devices"] });
    toast(t("Device revoked"));
  };
  return (
    <li className="flex flex-col gap-3 border-t py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Laptop className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-[15px] font-medium">{d.name}</p>
            <p className="text-[13px] text-muted-foreground">
              {d.online ? t("Connected") : d.lastSeenAt ? t("Last seen {time}", { time: relativeTime(d.lastSeenAt, locale) }) : t("Never connected")} ·{" "}
              {t("Agent {version}", { version: d.agentVersion ?? "?" })} · {d.arch}
              {d.updateAvailable && ` · ${t("update available (run the update yourself)")}`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          {t("Revoke")}
        </Button>
      </div>
      <label className="flex items-center justify-between gap-4 pl-7 text-[14px]">
        <span>{t("Pause this Mac")}</span>
        <Switch checked={d.paused} onCheckedChange={(v) => patch({ paused: v })} />
      </label>
      <label className="flex items-start justify-between gap-4 pl-7 text-[14px]">
        <span>
          {t("Run low-risk steps without asking")}
          <span className="block text-[13px] text-muted-foreground">{t("Off by default. Also needs `autoRunLow` on the Mac. Medium and high risk never run automatically.")}</span>
        </span>
        <Switch checked={d.autoRunLow} onCheckedChange={(v) => patch({ autoRunLow: v })} />
      </label>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{t("Revoke {name}?", { name: d.name })}</DialogTitle>
          <DialogDescription>{t("Its token stops working immediately. Queued setups for it won’t run. You can pair it again later.")}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" onClick={revoke}>
              {t("Revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function AgentSettings() {
  const t = useT();
  const { data, isLoading } = useDevices();
  const qc = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const togglePause = async (paused: boolean) => {
    await apiSend(paused ? "/api/execution/pause" : "/api/execution/resume", "POST").catch((e: Error) => toast.error(e.message));
    void qc.invalidateQueries({ queryKey: ["devices"] });
    toast(paused ? t("All execution paused") : t("Execution resumed"));
  };
  return (
    <div className="flex w-full flex-col gap-4">
      <label className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-[14px]">
        <span>
          <span className="font-medium">{t("Pause all execution")}</span>
          <span className="block text-[13px] text-muted-foreground">{t("Kill switch. Your Macs keep receiving plans but run nothing until you resume. Also: `aop-inbox pause`.")}</span>
        </span>
        <Switch checked={data?.executionPaused ?? false} onCheckedChange={togglePause} aria-label={t("Pause all execution")} />
      </label>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted/40" aria-hidden />
      ) : data?.devices.length ? (
        <ul>{data.devices.map((d) => <DeviceRow key={d.id} d={d} />)}</ul>
      ) : (
        <p className="text-[14px] text-muted-foreground">{t("No Mac connected. Setups can still be reviewed and followed manually.")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setPairOpen(true)}>
          <Laptop aria-hidden /> {t("Connect this Mac")}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/activity">{t("View recent actions")}</Link>
        </Button>
      </div>
      <div className="text-[13px] text-muted-foreground">
        <p className="mb-1 text-foreground/85">{t("Where setups may write")}</p>
        <ul className="flex flex-col gap-0.5 font-mono text-[12.5px]">
          <li>{t("~/aop-inbox-workspace — default")}</li>
          <li>{t("~/.claude settings, shell profile — only with your approval")}</li>
          <li>{t("everything else — never (SSH keys, keychains, browser profiles, cloud credentials are always off-limits)")}</li>
        </ul>
      </div>
      <PairDialog open={pairOpen} onOpenChange={setPairOpen} />
    </div>
  );
}

interface Prefs {
  timezone: string;
  quietStart: number;
  quietEnd: number;
  followUps: boolean;
}

export function NotificationSettings() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["preferences"], queryFn: ({ signal }) => apiGet<Prefs>("/api/preferences", signal) });
  const save = async (patch: Partial<Prefs>) => {
    try {
      await apiSend("/api/preferences", "PATCH", patch);
      void qc.invalidateQueries({ queryKey: ["preferences"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!data) return <div className="h-16 animate-pulse rounded bg-muted/40" aria-hidden />;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const select = "h-8 rounded-md border bg-surface px-2 text-[13px]";
  return (
    <div className="flex w-full flex-col gap-4 text-[14px]">
      <label className="flex items-start justify-between gap-4">
        <span>
          {t("Follow-ups")}
          <span className="block text-[13px] text-muted-foreground">{t("3 and 7 days after a setup: did you actually use it? Plus at most one reminder a day about something important you haven’t opened.")}</span>
        </span>
        <Switch checked={data.followUps} onCheckedChange={(v) => save({ followUps: v })} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("Quiet hours")}</span>
        <select aria-label={t("Quiet hours start")} className={select} value={data.quietStart} onChange={(e) => save({ quietStart: Number(e.target.value) })}>
          {hours.map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
          ))}
        </select>
        <span className="text-muted-foreground">{t("to")}</span>
        <select aria-label={t("Quiet hours end")} className={select} value={data.quietEnd} onChange={(e) => save({ quietEnd: Number(e.target.value) })}>
          {hours.map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span>{t("Time zone: {timezone}", { timezone: data.timezone })}</span>
        {local !== data.timezone && (
          <Button variant="ghost" size="xs" onClick={() => save({ timezone: local })}>
            {t("Use {timezone}", { timezone: local })}
          </Button>
        )}
      </div>
    </div>
  );
}
