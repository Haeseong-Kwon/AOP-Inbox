"use client";

import { ArrowUpRight, Check, Loader2, MessageSquareQuote, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { useFeedback, useSetup } from "@/lib/client/queries";
import type { ItemDetail } from "@/lib/items/types";
import { RiskBadge } from "./risk";

/**
 * The ACTION block inside item detail. Knowledge items show nothing here —
 * this appears only when there's something to do.
 */
export function ActionPanel({ item }: { item: ItemDetail }) {
  const actionish = item.actionState && item.actionState !== "knowledge";
  const { data: setup, isLoading } = useSetup(item.id, Boolean(actionish));
  const feedback = useFeedback(item.id);

  if (!actionish) return null;

  if (item.actionState === "analyzing" || (isLoading && !setup)) {
    return (
      <section aria-label="Actions" className="rounded-lg border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Looking for things you can apply…
        </span>
      </section>
    );
  }

  if (setup?.spec.guideRequired && setup.spec.steps.length === 0) {
    return (
      <section aria-labelledby="guide-title" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="guide-title" className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <Zap className="size-4 text-signal" aria-hidden /> Additional guide required
        </h2>
        <GuideGate itemId={item.id} keyword={setup.spec.guideRequired.keyword} guides={item.guides} />
      </section>
    );
  }

  // Actionable content with no runnable plan: a hand-done checklist.
  if (!setup || setup.policy.decision === "none") {
    if (!item.actionItems.length) return null;
    return (
      <section aria-labelledby="todo-title" className="flex flex-col gap-3">
        <h2 id="todo-title" className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <Zap className="size-3.5 text-signal" aria-hidden /> Things to try
        </h2>
        <ChecklistWithApply itemId={item.id} items={item.actionItems} applied={Boolean(item.appliedAt)} />
      </section>
    );
  }

  const { spec, policy, job } = setup;
  const userSteps = spec.steps.filter((s) => s.type === "user_action" || s.needsUser).length;
  const statusLine = job
    ? job.statusLabel
    : policy.decision === "blocked"
      ? "Blocked for automatic execution"
      : policy.decision === "manual_only"
        ? "Follow these steps yourself"
        : policy.requiresApproval
          ? "Review required before running"
          : "Ready to apply";

  return (
    <section aria-labelledby="actions-title" className="flex flex-col gap-4 border-t pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="actions-title" className="inline-flex items-center gap-2 text-[15px] font-semibold">
            <Zap className="size-4 text-signal" aria-hidden /> Actions detected
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {spec.steps.length} setup {spec.steps.length === 1 ? "step" : "steps"}
            {userSteps ? `, ${userSteps} for you` : ""} · {statusLine}
          </p>
        </div>
        <RiskBadge risk={policy.risk} className="shrink-0 pt-1" />
      </div>

      {spec.guideRequired && <GuideGate itemId={item.id} keyword={spec.guideRequired.keyword} guides={item.guides} />}

      {spec.steps.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {spec.steps.slice(0, 5).map((s, i) => (
            <li key={s.id} className="flex gap-3 text-[14px]">
              <span className="w-4 shrink-0 text-right text-xs leading-6 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="leading-6">{s.title}</span>
            </li>
          ))}
          {spec.steps.length > 5 && <li className="pl-7 text-xs text-muted-foreground">+ {spec.steps.length - 5} more</li>}
        </ol>
      )}

      {item.whatYouCanDo && (
        <div>
          <h3 className="mb-1 text-[13px] font-medium text-muted-foreground">What you can do with it</h3>
          <p className="font-reading text-[16px] leading-[1.6]">{item.whatYouCanDo}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href={`/items/${item.id}/setup`}>Review setup</Link>
        </Button>
        {item.appliedAt && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Check className="size-3.5 text-signal" aria-hidden /> Applied {relativeTime(item.appliedAt)}
          </span>
        )}
      </div>

      {item.appliedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-[13px]">
          <span className="text-muted-foreground">Did you actually use it?</span>
          <Button variant="ghost" size="xs" onClick={() => feedback.mutate({ kind: "used", jobId: job?.id })}>
            Used it
          </Button>
          <Button variant="ghost" size="xs" onClick={() => feedback.mutate({ kind: "not_using", jobId: job?.id })}>
            Not using it
          </Button>
        </div>
      )}
    </section>
  );
}

function ChecklistWithApply({ itemId, items, applied }: { itemId: string; items: string[]; applied: boolean }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const feedback = useFeedback(itemId);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((a, i) => (
          <li key={a}>
            <label className="flex cursor-pointer gap-3 text-[14.5px] leading-relaxed">
              <input
                type="checkbox"
                checked={done.has(i)}
                onChange={() => setDone((d) => (d.has(i) ? new Set([...d].filter((x) => x !== i)) : new Set(d).add(i)))}
                className="mt-[0.35em] size-3.5 shrink-0 accent-[var(--signal)]"
              />
              <span className={done.has(i) ? "text-muted-foreground line-through" : ""}>{a}</span>
            </label>
          </li>
        ))}
      </ul>
      {applied ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Check className="size-3.5 text-signal" aria-hidden /> Applied
        </span>
      ) : (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => feedback.mutate({ kind: "applied" })}>
          Mark as applied
        </Button>
      )}
    </div>
  );
}

function GuideGate({ itemId, keyword, guides }: { itemId: string; keyword?: string; guides: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const attach = async () => {
    if (!text.trim()) return;
    setPending(true);
    try {
      await apiSend(`/api/items/${itemId}/guide`, "POST", { input: text });
      toast.success("Guide attached — updating the setup");
      setText("");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3.5">
      <p className="inline-flex items-center gap-2 text-[14px] font-medium">
        <MessageSquareQuote className="size-4 text-muted-foreground" aria-hidden /> This post needs a guide from the creator
      </p>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13.5px] text-muted-foreground marker:text-muted-foreground/70">
        <li>Follow the creator, if you choose to.</li>
        <li>Leave the requested keyword{keyword ? ` (“${keyword}”)` : ""} — AOP Inbox never comments for you.</li>
        <li>Paste the guide you receive here.</li>
      </ol>
      {guides.length > 0 && (
        <ul className="flex flex-col gap-1">
          {guides.map((g) => (
            <li key={g.id}>
              <Link href={`/inbox?item=${g.id}`} className="inline-flex items-center gap-1 text-[13px] text-signal hover:underline">
                {g.title} <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            aria-label="Guide text or link"
            placeholder="Paste the guide text or a link to it"
            className="w-full resize-y rounded-md border bg-surface px-3 py-2 text-sm outline-none focus:border-signal/50"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={attach} disabled={pending || !text.trim()}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} Attach guide
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
          Attach guide
        </Button>
      )}
    </div>
  );
}
