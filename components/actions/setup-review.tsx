"use client";

import { AlertTriangle, ArrowLeft, Check, Copy, FileText, Laptop, ListChecks, Loader2, Quote, ShieldAlert, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { mcpCommand, type SetupStep } from "@aop-inbox/core/browser";
import { SourceIcon } from "@/components/inbox/source-icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/client/format";
import { useFeedback, useRunSetup, useSetup } from "@/lib/client/queries";
import type { SetupView } from "@/lib/execution/types";
import { cn } from "@/lib/utils";
import { JobProgress } from "./job-progress";
import { DECISION_LABELS, RiskBadge, STEP_TYPE_LABELS } from "./risk";

const commandsFor = (s: SetupStep) => (s.type === "mcp_add" && s.mcp ? [mcpCommand(s) ?? ""] : s.commands);

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-[14px]">{children}</dd>
    </div>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="group flex items-start gap-2 rounded-md bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 font-mono text-[12.5px] leading-relaxed break-all text-foreground/90">{text}</code>
      <button
        type="button"
        aria-label="Copy command"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copied"))}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

function StepCard({ step, index, setup, manual, checked, onCheck }: { step: SetupStep; index: number; setup: SetupView; manual: boolean; checked: boolean; onCheck: () => void }) {
  const policy = setup.policy.steps.find((p) => p.stepId === step.id)!;
  const explain = setup.explain[step.id];
  const plan = setup.plan.filter((p) => p.stepId === step.id);
  const result = setup.job?.steps.find((s) => s.stepId === step.id);
  const showExplain = policy.risk !== "low" || policy.decision === "blocked" || step.type === "user_action";
  const commands = commandsFor(step).filter(Boolean);

  return (
    <li className={cn("flex gap-4 border-t py-5 first:border-t-0", policy.decision === "blocked" && "rounded-lg border border-destructive/30 bg-destructive/[0.04] px-4 first:border-t")}>
      <div className="flex w-6 shrink-0 flex-col items-center pt-0.5">
        {manual ? (
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Mark “${step.title}” done`} className="size-4 accent-[var(--signal)]" />
        ) : result?.status === "done" || result?.status === "skipped" ? (
          <Check className="size-4 text-signal" aria-label="Done" />
        ) : (
          <span className="text-[13px] font-medium text-muted-foreground tabular-nums">{index + 1}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className={cn("text-[15px] font-semibold", manual && checked && "text-muted-foreground line-through")}>{step.title}</h3>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{STEP_TYPE_LABELS[step.type]}</span>
            {policy.risk !== "low" && <RiskBadge risk={policy.risk} />}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {DECISION_LABELS[policy.decision]}
          {result && result.status !== "pending" && ` · ${result.result?.summary ?? result.status}`}
        </p>

        {showExplain && explain && (
          <dl className="grid gap-x-6 gap-y-2.5 text-[13.5px] sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">What this does</dt>
              <dd>{explain.whatItDoes}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Why it’s needed</dt>
              <dd>{explain.whyNeeded}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">What changes</dt>
              <dd>{explain.whatChanges}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">How to undo</dt>
              <dd>{explain.howToUndo}</dd>
            </div>
          </dl>
        )}
        {!showExplain && <p className="text-[14px] leading-relaxed">{step.instruction}</p>}

        {commands.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {commands.map((c) => (
              <CodeLine key={c} text={c} />
            ))}
          </div>
        )}
        {step.change && (
          <p className="inline-flex items-center gap-1.5 font-mono text-[12.5px] text-muted-foreground">
            <FileText className="size-3.5" aria-hidden /> {step.change.path}
          </p>
        )}
        {plan.some((p) => p.diffPreview) && (
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none">Preview the change</summary>
            <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {plan.map((p) => p.diffPreview).filter(Boolean).join("\n")}
            </pre>
          </details>
        )}
        {plan.some((p) => p.type === "skip") && <p className="text-[13px] text-signal">{plan.find((p) => p.type === "skip")!.description}</p>}

        {step.evidence?.quote && (
          <p className="flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Source{step.evidence.source ? ` · ${step.evidence.source}` : ""}
              {step.evidence.timestampSec !== undefined ? ` at ${Math.floor(step.evidence.timestampSec / 60)}:${String(Math.floor(step.evidence.timestampSec % 60)).padStart(2, "0")}` : ""}: “{step.evidence.quote}”
            </span>
          </p>
        )}
        {policy.decision === "blocked" && (
          <ul className="flex flex-col gap-1 text-[13px] text-destructive">
            {policy.reasons.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {policy.decision !== "blocked" && policy.risk !== "low" && policy.reasons.length > 0 && (
          <p className="text-[12.5px] text-muted-foreground">Why it’s {policy.risk} risk: {policy.reasons[0]}</p>
        )}
      </div>
    </li>
  );
}

export function SetupReview({ itemId }: { itemId: string }) {
  const { data: setup, isLoading, isError, error } = useSetup(itemId);
  const run = useRunSetup(itemId);
  const feedback = useFeedback(itemId);
  const [manual, setManual] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  if (isLoading) return <div className="mx-auto max-w-[760px] px-5 pt-14 text-sm text-muted-foreground">Loading setup…</div>;
  if (isError) return <div className="mx-auto max-w-[760px] px-5 pt-14 text-sm text-muted-foreground">{error.message}</div>;
  if (!setup) {
    return (
      <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-5 pt-14">
        <p className="text-[15px]">There’s no setup plan for this item.</p>
        <Link href={`/inbox?item=${itemId}`} className="text-sm text-signal hover:underline">
          Back to the item
        </Link>
      </div>
    );
  }

  const { spec, policy, device, job } = setup;
  const minConfidence = Math.min(...spec.steps.map((s) => s.confidence), 1);
  const files = [...new Set(policy.steps.flatMap((s) => s.writes.map((w) => w.path)))];
  const commands = spec.steps.flatMap(commandsFor).filter(Boolean);
  const activeJob = job && !["done", "failed", "cancelled", "expired", "rolled_back"].includes(job.status);
  const canRun = !activeJob && (policy.decision === "approve" || policy.decision === "auto") && Boolean(device) && !setup.executionPaused;
  const blocked = policy.decision === "blocked";

  const copySteps = () => navigator.clipboard.writeText(setup.checklist).then(() => toast("Steps copied"));

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-40 sm:px-8 md:pt-10">
      <Link href={`/inbox?item=${itemId}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Back to item
      </Link>

      <header className="flex flex-col gap-4 pt-5 pb-6">
        <p className="text-[13px] font-medium text-signal">Setup</p>
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-[26px]">{spec.source.title ?? spec.summary}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{spec.summary}</p>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border px-4 py-3.5 sm:grid-cols-4">
          <Meta label="Source">
            <span className="inline-flex items-center gap-1.5">
              <SourceIcon type={spec.source.platform as never} className="text-muted-foreground" />
              <span className="truncate">{spec.source.creator ?? spec.source.platform}</span>
            </span>
          </Meta>
          <Meta label="Confidence">{Math.round(minConfidence * 100)}%</Meta>
          <Meta label="Risk">
            <RiskBadge risk={policy.risk} className="text-[14px]" />
          </Meta>
          <Meta label="Steps">{spec.steps.length}</Meta>
        </dl>
      </header>

      {blocked && (
        <div role="alert" className="mb-6 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-4 py-3.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1.5 text-[14px]">
            <p className="font-medium">Blocked for automatic execution</p>
            <p className="text-muted-foreground">This setup includes a step that needs system-level access or looks unsafe. AOP Inbox won’t run it automatically.</p>
            <button type="button" onClick={() => setManual(true)} className="w-fit text-[13px] text-foreground underline underline-offset-4">
              View manual instructions
            </button>
          </div>
        </div>
      )}
      {spec.suspiciousInstructions.length > 0 && (
        <div className="mb-6 flex gap-3 rounded-lg border px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1.5 text-[14px]">
            <p className="font-medium">The source contains instructions aimed at AI tools</p>
            <p className="text-[13px] text-muted-foreground">They were ignored, and every related step needs your review.</p>
            <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              {spec.suspiciousInstructions.slice(0, 3).map((s) => (
                <li key={s} className="font-mono text-[12px] break-words">“{s}”</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {setup.conflicts.length > 0 && (
        <p className="mb-6 rounded-lg border px-4 py-3 text-[13.5px]">
          <span className="font-medium">Potential conflict</span> — {setup.conflicts.map((c) => `“${c.itemTitle}” also changes ${c.targets.join(", ")}`).join("; ")}.
        </p>
      )}

      {job && <JobProgress job={job} itemId={itemId} device={device} />}

      {(files.length > 0 || commands.length > 0) && !manual && (
        <section aria-label="Changes" className="mb-2 grid gap-5 border-y py-5 sm:grid-cols-2">
          {files.length > 0 && (
            <div>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <FileText className="size-3.5" aria-hidden /> Files affected
              </h2>
              <ul className="flex flex-col gap-1 font-mono text-[12.5px]">
                {files.map((f) => (
                  <li key={f} className="break-all">{f}</li>
                ))}
              </ul>
            </div>
          )}
          {commands.length > 0 && (
            <div>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <Terminal className="size-3.5" aria-hidden /> Commands
              </h2>
              <ul className="flex flex-col gap-1 font-mono text-[12.5px]">
                {commands.map((c) => (
                  <li key={c} className="break-all">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <ol aria-label="Steps">
        {spec.steps.map((s, i) => (
          <StepCard
            key={s.id}
            step={s}
            index={i}
            setup={setup}
            manual={manual}
            checked={checked.has(s.id)}
            onCheck={() => setChecked((c) => (c.has(s.id) ? new Set([...c].filter((x) => x !== s.id)) : new Set(c).add(s.id)))}
          />
        ))}
      </ol>

      {spec.usageHint && (
        <p className="mt-4 rounded-lg bg-surface px-4 py-3 text-[14px]">
          <span className="text-muted-foreground">Try it afterwards: </span>“{spec.usageHint}”
        </p>
      )}

      {setup.history.length > 1 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Earlier runs</h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {setup.history.slice(1).map((h) => (
              <li key={h.id} className="flex justify-between gap-4">
                <span>{h.statusLabel}</span>
                <span className="text-muted-foreground">{relativeTime(h.completedAt ?? h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 backdrop-blur md:bottom-0 md:left-[236px]">
        <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
          {manual ? (
            <>
              <span className="mr-auto text-[13px] text-muted-foreground">
                {checked.size}/{spec.steps.length} done
              </span>
              <Button variant="ghost" size="sm" onClick={() => setManual(false)}>
                Back to review
              </Button>
              <Button size="sm" disabled={checked.size < spec.steps.length} onClick={() => feedback.mutate({ kind: "applied" })}>
                <Check aria-hidden /> Mark as applied
              </Button>
            </>
          ) : (
            <>
              <DeviceLine setup={setup} />
              <Button variant="ghost" size="sm" onClick={copySteps}>
                <Copy aria-hidden /> Copy steps
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManual(true)}>
                <ListChecks aria-hidden /> Do manually
              </Button>
              <Button size="sm" disabled={!canRun || run.isPending} onClick={() => run.mutate()}>
                {run.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Run with AOP Inbox
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DeviceLine({ setup }: { setup: SetupView }) {
  const d = setup.device;
  return (
    <span className="mr-auto inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <Laptop className="size-3.5 shrink-0" aria-hidden />
      {!d ? (
        <Link href="/settings#agent" className="text-signal hover:underline">
          Connect your Mac to run this
        </Link>
      ) : setup.executionPaused ? (
        <span>Execution is paused</span>
      ) : (
        <span className="truncate">
          {d.name} · {d.online ? "connected" : `last seen ${d.lastSeenAt ? relativeTime(d.lastSeenAt) : "never"}`}
        </span>
      )}
    </span>
  );
}
