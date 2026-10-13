"use client";

import { Check, CircleDashed, Loader2, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/client/format";
import { useFeedback, useJobAction } from "@/lib/client/queries";
import type { DeviceView, JobView } from "@/lib/execution/types";
import { cn } from "@/lib/utils";
import { RiskBadge } from "./risk";

/** People-centred timeline built from the append-only event ledger. */
const MILESTONES: { key: string; label: string; events: string[] }[] = [
  { key: "received", label: "Received", events: ["setup_spec_used"] },
  { key: "plan", label: "Plan created", events: ["dry_run_completed"] },
  { key: "approved", label: "Approved", events: ["approval_granted"] },
  { key: "snapshot", label: "Snapshot", events: ["snapshot_created"] },
  { key: "executed", label: "Executed", events: ["step_completed", "step_skipped"] },
  { key: "verified", label: "Verified", events: ["verify_passed"] },
  { key: "completed", label: "Completed", events: ["job_completed"] },
];

function Timeline({ job }: { job: JobView }) {
  const seen = new Map<string, string>();
  for (const e of job.events) for (const m of MILESTONES) if (m.events.includes(e.type) && !seen.has(m.key)) seen.set(m.key, e.at);
  const failed = job.events.find((e) => ["job_failed", "policy_denied", "rollback_failed"].includes(e.type));
  const rolled = job.events.find((e) => e.type === "rollback_completed");
  const items = MILESTONES.filter((m) => seen.has(m.key) || !failed).map((m) => ({ label: m.label, at: seen.get(m.key) ?? null }));
  if (failed) items.push({ label: job.errorMessage ?? "Failed", at: failed.at });
  if (rolled) items.push({ label: "Restored previous state", at: rolled.at });
  return (
    <ol className="flex flex-col gap-0" aria-label="Timeline">
      {items.map((m, i) => (
        <li key={`${m.label}-${i}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn("mt-1 flex size-3.5 items-center justify-center rounded-full border", m.at ? "border-signal bg-signal" : "border-muted-foreground/40")}>
              {m.at && <Check className="size-2.5 text-primary-foreground" aria-hidden />}
            </span>
            {i < items.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className="flex flex-1 justify-between gap-4 pb-3 text-[13.5px]">
            <span className={m.at ? "" : "text-muted-foreground"}>{m.label}</span>
            {m.at && <time className="text-xs text-muted-foreground">{relativeTime(m.at)}</time>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Results({ job }: { job: JobView }) {
  const changed = job.steps.flatMap((s) => s.result?.changedFiles ?? []);
  const installed = [...new Set(job.steps.flatMap((s) => s.result?.installed ?? []))];
  const verified = job.steps.map((s) => s.result?.verify).filter((v) => v?.ok);
  const skipped = job.steps.filter((s) => s.status === "skipped");
  if (!changed.length && !installed.length && !verified.length && !skipped.length) return null;
  return (
    <dl className="grid gap-4 text-[13.5px] sm:grid-cols-3">
      {changed.length > 0 && (
        <div>
          <dt className="mb-1 text-xs text-muted-foreground">Changed</dt>
          {changed.map((f) => (
            <dd key={f.path} className="font-mono text-[12.5px] break-all">
              {f.path} <span className="text-muted-foreground">+{f.added}{f.removed ? ` −${f.removed}` : ""}</span>
            </dd>
          ))}
        </div>
      )}
      {installed.length > 0 && (
        <div>
          <dt className="mb-1 text-xs text-muted-foreground">Installed</dt>
          {installed.map((p) => (
            <dd key={p} className="font-mono text-[12.5px]">{p}</dd>
          ))}
        </div>
      )}
      {(verified.length > 0 || skipped.length > 0) && (
        <div>
          <dt className="mb-1 text-xs text-muted-foreground">Verified</dt>
          {verified.map((v) => (
            <dd key={v!.detail}>{v!.detail}</dd>
          ))}
          {skipped.map((s) => (
            <dd key={s.stepId} className="text-muted-foreground">{s.title}: already configured</dd>
          ))}
        </div>
      )}
    </dl>
  );
}

function ApproveDialog({ job, open, onOpenChange, onApprove, pending }: { job: JobView; open: boolean; onOpenChange: (o: boolean) => void; onApprove: () => void; pending: boolean }) {
  const plan = job.plan ?? [];
  const partial = plan.some((p) => p.reversible !== "yes" && p.type !== "user_action" && p.type !== "skip");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Approve this setup once?</DialogTitle>
        <DialogDescription>Your Mac will run exactly these actions, then verify them.</DialogDescription>
        <div className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto text-[13.5px]">
          <RiskBadge risk={job.risk} />
          <ul className="flex flex-col gap-2">
            {plan.filter((p) => p.type !== "skip").map((p, i) => (
              <li key={`${p.stepId}-${i}`} className="flex flex-col gap-1">
                <span>{p.description}</span>
                {p.command && <code className="rounded bg-surface px-2 py-1 font-mono text-[12px] break-all">{p.command}</code>}
                {p.path && <span className="font-mono text-[12px] text-muted-foreground break-all">{p.path}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">
            {partial ? "Files are snapshotted and restored on Undo. Installed software is not removed automatically." : "Every change is snapshotted and can be undone."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onApprove} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />} Approve once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JobProgress({ job, itemId, device }: { job: JobView; itemId: string; device: DeviceView | null }) {
  const action = useJobAction(itemId);
  const feedback = useFeedback(itemId);
  const [approveOpen, setApproveOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const act = (a: "approve" | "reject" | "undo" | "continue") => action.mutate({ jobId: job.id, action: a }, { onSuccess: () => setApproveOpen(false) });
  const waitingStep = job.steps.find((s) => s.status === "needs_user");
  const reversible = job.steps.every((s) => !s.result || s.result.reversible === "yes");

  let headline: React.ReactNode;
  let body: React.ReactNode = null;
  switch (job.status) {
    case "planning":
    case "queued":
      headline = device?.online ? (job.status === "planning" ? "Preparing a dry run on your Mac…" : "Starting on your Mac…") : "Waiting for your Mac";
      body = !device?.online && (
        <p className="text-[13px] text-muted-foreground">
          {device?.lastSeenAt ? `${device.name} was last seen ${relativeTime(device.lastSeenAt)}.` : "Start the agent with `aop-inbox start`."} It runs as soon as your Mac connects (until {new Date(job.expiresAt).toLocaleDateString()}).
        </p>
      );
      break;
    case "awaiting_approval":
      headline = "Ready for your approval";
      body = (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setApproveOpen(true)}>
            Review &amp; approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act("reject")} disabled={action.isPending}>
            Reject
          </Button>
        </div>
      );
      break;
    case "executing":
    case "verifying":
      headline = job.status === "verifying" ? "Verifying that it works…" : "Running on your Mac…";
      break;
    case "needs_user_action":
      headline = "This step needs you";
      body = (
        <div className="flex flex-col gap-2">
          <p className="text-[14px]">{waitingStep?.result?.summary ?? waitingStep?.title}</p>
          <Button size="sm" className="w-fit" onClick={() => act("continue")} disabled={action.isPending}>
            I’ve done it — continue
          </Button>
        </div>
      );
      break;
    case "done":
      headline = "Applied and verified";
      body = (
        <div className="flex flex-col gap-4">
          <Results job={job} />
          {job.usageHint && (
            <p className="text-[14px]">
              <span className="text-muted-foreground">Try it now: </span>“{job.usageHint}”
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => feedback.mutate({ kind: "used", jobId: job.id })}>
              Used it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act("undo")} disabled={action.isPending}>
              <RotateCcw aria-hidden /> Undo
            </Button>
            {!reversible && <span className="text-xs text-muted-foreground">Undo restores files; installed packages stay.</span>}
          </div>
        </div>
      );
      break;
    case "failed": {
      const restored = job.events.some((e) => e.type === "rollback_completed");
      headline = job.errorMessage ?? "Something went wrong";
      body = (
        <div className="flex flex-col gap-2">
          {restored && <p className="text-[14px]">Your previous configuration has been restored.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDetails((d) => !d)}>
              {details ? "Hide details" : "View details"}
            </Button>
            {!restored && job.steps.some((s) => s.status === "done") && (
              <Button size="sm" variant="ghost" onClick={() => act("undo")}>
                <RotateCcw aria-hidden /> Undo what ran
              </Button>
            )}
          </div>
          {details && job.errorDetail && <pre className="rounded-md bg-surface px-3 py-2 font-mono text-[12px] whitespace-pre-wrap">{job.errorDetail}</pre>}
        </div>
      );
      break;
    }
    case "rolling_back":
      headline = "Undoing on your Mac…";
      break;
    case "rolled_back":
      headline = "Undone";
      body = <p className="text-[13px] text-muted-foreground">{String(job.events.findLast((e) => e.type === "rollback_completed")?.payload.detail ?? "Your previous state was restored.")}</p>;
      break;
    default:
      headline = job.statusLabel;
  }

  const busy = ["planning", "queued", "executing", "verifying", "rolling_back"].includes(job.status) && device?.online;
  const Icon = job.status === "done" ? Check : job.status === "failed" ? X : busy ? Loader2 : CircleDashed;

  return (
    <section aria-label="Execution" className="mb-8 rounded-xl border bg-card px-5 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        <div className="flex flex-1 flex-col gap-3">
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold" aria-live="polite">
            <Icon className={cn("size-4", busy && "animate-spin", job.status === "done" ? "text-signal" : job.status === "failed" ? "text-destructive" : "text-muted-foreground")} aria-hidden />
            {headline}
          </h2>
          {body}
        </div>
        <div className="sm:w-56 sm:border-l sm:pl-6">
          <Timeline job={job} />
        </div>
      </div>
      {job.status === "awaiting_approval" && <ApproveDialog job={job} open={approveOpen} onOpenChange={setApproveOpen} onApprove={() => act("approve")} pending={action.isPending} />}
    </section>
  );
}
