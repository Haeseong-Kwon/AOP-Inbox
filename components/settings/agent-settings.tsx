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

function Copyable({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{text}</code>
      <button type="button" aria-label="Copy" onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copied"))} className="text-muted-foreground hover:text-foreground">
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

function PairDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
        <DialogTitle>Connect this Mac</DialogTitle>
        <DialogDescription>The agent connects out to AOP Inbox; nothing on your Mac listens for connections. Its token is kept in your login Keychain.</DialogDescription>
        {!code ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px]">
            <li>Install Node 22.13+ and Claude Code on the Mac.</li>
            <li>Create a one-time code (valid for 10 minutes).</li>
            <li>Run the command it shows in Terminal.</li>
          </ol>
        ) : (
          <div className="flex flex-col gap-3 text-[14px]">
            <p>
              Code <span className="font-mono text-[16px] font-semibold tracking-wider">{code.code}</span>
              <span className="text-[13px] text-muted-foreground"> · expires {relativeTime(code.expiresAt)}</span>
            </p>
            <p className="text-[13px] text-muted-foreground">From the AOP Inbox repository:</p>
            <Copyable text={`pnpm --filter @aop-inbox/agent build && node packages/agent/dist/cli.js init --server ${origin} --code ${code.code}`} />
            <p className="text-[13px] text-muted-foreground">Then keep it running (or add <code className="font-mono">--launchd</code> to start at login):</p>
            <Copyable text="node packages/agent/dist/cli.js start" />
          </div>
        )}
        <DialogFooter>
          {!code ? (
            <Button onClick={create} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} Create pairing code
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({ d }: { d: DeviceView }) {
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
    toast("Device revoked");
  };
  return (
    <li className="flex flex-col gap-3 border-t py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Laptop className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-[15px] font-medium">{d.name}</p>
            <p className="text-[13px] text-muted-foreground">
              {d.online ? "Connected" : d.lastSeenAt ? `Last seen ${relativeTime(d.lastSeenAt)}` : "Never connected"} · Agent {d.agentVersion ?? "?"} · {d.arch}
              {d.updateAvailable && " · update available (run the update yourself)"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          Revoke
        </Button>
      </div>
      <label className="flex items-center justify-between gap-4 pl-7 text-[14px]">
        <span>Pause this Mac</span>
        <Switch checked={d.paused} onCheckedChange={(v) => patch({ paused: v })} />
      </label>
      <label className="flex items-start justify-between gap-4 pl-7 text-[14px]">
        <span>
          Run low-risk steps without asking
          <span className="block text-[13px] text-muted-foreground">Off by default. Also needs `autoRunLow` on the Mac. Medium and high risk never run automatically.</span>
        </span>
        <Switch checked={d.autoRunLow} onCheckedChange={(v) => patch({ autoRunLow: v })} />
      </label>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Revoke {d.name}?</DialogTitle>
          <DialogDescription>Its token stops working immediately. Queued setups for it won’t run. You can pair it again later.</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={revoke}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function AgentSettings() {
  const { data, isLoading } = useDevices();
  const qc = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const togglePause = async (paused: boolean) => {
    await apiSend(paused ? "/api/execution/pause" : "/api/execution/resume", "POST").catch((e: Error) => toast.error(e.message));
    void qc.invalidateQueries({ queryKey: ["devices"] });
    toast(paused ? "All execution paused" : "Execution resumed");
  };
  return (
    <div className="flex w-full flex-col gap-4">
      <label className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-[14px]">
        <span>
          <span className="font-medium">Pause all execution</span>
          <span className="block text-[13px] text-muted-foreground">Kill switch. Your Macs keep receiving plans but run nothing until you resume. Also: `aop-inbox pause`.</span>
        </span>
        <Switch checked={data?.executionPaused ?? false} onCheckedChange={togglePause} aria-label="Pause all execution" />
      </label>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted/40" aria-hidden />
      ) : data?.devices.length ? (
        <ul>{data.devices.map((d) => <DeviceRow key={d.id} d={d} />)}</ul>
      ) : (
        <p className="text-[14px] text-muted-foreground">No Mac connected. Setups can still be reviewed and followed manually.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setPairOpen(true)}>
          <Laptop aria-hidden /> Connect this Mac
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/activity">View recent actions</Link>
        </Button>
      </div>
      <div className="text-[13px] text-muted-foreground">
        <p className="mb-1 text-foreground/85">Where setups may write</p>
        <ul className="flex flex-col gap-0.5 font-mono text-[12.5px]">
          <li>~/aop-inbox-workspace — default</li>
          <li>~/.claude settings, shell profile — only with your approval</li>
          <li>everything else — never (SSH keys, keychains, browser profiles, cloud credentials are always off-limits)</li>
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
          Follow-ups
          <span className="block text-[13px] text-muted-foreground">3 and 7 days after a setup: did you actually use it? Plus at most one reminder a day about something important you haven’t opened.</span>
        </span>
        <Switch checked={data.followUps} onCheckedChange={(v) => save({ followUps: v })} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span>Quiet hours</span>
        <select aria-label="Quiet hours start" className={select} value={data.quietStart} onChange={(e) => save({ quietStart: Number(e.target.value) })}>
          {hours.map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
          ))}
        </select>
        <span className="text-muted-foreground">to</span>
        <select aria-label="Quiet hours end" className={select} value={data.quietEnd} onChange={(e) => save({ quietEnd: Number(e.target.value) })}>
          {hours.map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span>Time zone: {data.timezone}</span>
        {local !== data.timezone && (
          <Button variant="ghost" size="xs" onClick={() => save({ timezone: local })}>
            Use {local}
          </Button>
        )}
      </div>
    </div>
  );
}
