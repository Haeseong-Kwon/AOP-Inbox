"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileArchive, Loader2, ShieldCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ImportStats } from "@/db/schema";
import { apiSend } from "@/lib/client/api";
import type { ImportPreview } from "@/lib/import/service";
import { extractLinksFromFile, ImportFileError, type ExtractedLink } from "@/lib/import/meta-export";
import { cn } from "@/lib/utils";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; fileName: string }
  | { kind: "preview"; fileName: string; links: ExtractedLink[]; preview: ImportPreview }
  | { kind: "importing" }
  | { kind: "done"; stats: ImportStats };

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between py-2", strong && "font-semibold")}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}

export function ImportFlow() {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [includeOther, setIncludeOther] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const preview = async (links: ExtractedLink[], include: boolean) =>
    apiSend<ImportPreview>("/api/import/preview", "POST", { links, includeOtherLinks: include });

  const handleFile = async (file: File) => {
    setError(null);
    setStep({ kind: "reading", fileName: file.name });
    try {
      // Parsed entirely in this browser tab — only links and timestamps are sent.
      const links = await extractLinksFromFile(file);
      if (links.length === 0) {
        setError("We didn't find any links in this file. Make sure it's the Messages export in JSON format.");
        setStep({ kind: "pick" });
        return;
      }
      setStep({ kind: "preview", fileName: file.name, links, preview: await preview(links, includeOther) });
    } catch (e) {
      setError(e instanceof ImportFileError ? e.message : (e as Error).message || "We couldn't read this file.");
      setStep({ kind: "pick" });
    }
  };

  const toggleOther = async (value: boolean) => {
    setIncludeOther(value);
    if (step.kind === "preview") setStep({ ...step, preview: await preview(step.links, value) });
  };

  const commit = async () => {
    if (step.kind !== "preview") return;
    const links = step.links;
    setStep({ kind: "importing" });
    try {
      const { stats } = await apiSend<{ stats: ImportStats }>("/api/import/commit", "POST", { links, includeOtherLinks: includeOther });
      void qc.invalidateQueries();
      setStep({ kind: "done", stats });
    } catch (e) {
      setError((e as Error).message);
      setStep({ kind: "pick" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <header className="flex flex-col gap-1.5 pb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Import Instagram history</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Bring in every Reel you’ve sent yourself, using the copy of your data Meta gives you.
        </p>
      </header>

      <div className="mb-8 flex gap-3 rounded-lg border bg-surface px-4 py-3.5 text-[14px] leading-relaxed">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        <p>
          AOP-Inbox extracts supported links. Your full message history is not stored. The file is read on this device; only links and dates are
          sent.
        </p>
      </div>

      {step.kind === "pick" && (
        <>
          <ol className="mb-8 flex list-decimal flex-col gap-2 pl-5 text-[14.5px] leading-relaxed text-foreground/85 marker:text-muted-foreground">
            <li>
              In Instagram, open <span className="font-medium">Accounts Center → Your information and permissions → Download your information</span>.
            </li>
            <li>Choose Messages, format JSON, and request the download.</li>
            <li>When Meta emails you, download the .zip and drop it here.</li>
          </ol>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
              dragging ? "border-signal bg-signal-soft" : "hover:border-foreground/25 hover:bg-accent/40",
            )}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-[15px] font-medium">Choose your export file</span>
            <span className="text-[13px] text-muted-foreground">.zip from Meta, or a .json / .html file from inside it</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.json,.html,.htm,application/zip,application/json,text/html"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}

      {step.kind === "reading" && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-6 text-[15px]" role="status">
          <Loader2 className="size-4 animate-spin text-signal" aria-hidden />
          Scanning {step.fileName} for links…
        </div>
      )}

      {step.kind === "preview" && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
            <FileArchive className="size-4" aria-hidden />
            <span className="truncate">{step.fileName}</span>
          </div>
          <div>
            <p className="pb-2 text-[22px] font-semibold tracking-[-0.015em] tabular-nums">Found {step.preview.totalLinks.toLocaleString()} links</p>
            <dl className="divide-y border-y text-[15px]">
              <Row label="Instagram Reels" value={step.preview.instagramReels} />
              <Row label="Instagram posts" value={step.preview.instagramPosts} />
              <Row label="Other links" value={step.preview.otherLinks} />
              <Row label="Duplicates" value={step.preview.duplicates} />
              <Row label="New items" value={step.preview.newItems} strong />
            </dl>
          </div>
          <label className="flex items-center justify-between gap-4 text-[14.5px]">
            <span>
              Also import other links
              <span className="block text-[13px] text-muted-foreground">Articles, YouTube and anything else you shared with yourself.</span>
            </span>
            <Switch checked={includeOther} onCheckedChange={toggleOther} />
          </label>
          <div className="flex gap-2">
            <Button size="lg" onClick={commit} disabled={step.preview.newItems === 0}>
              Import {step.preview.newItems.toLocaleString()} items
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setStep({ kind: "pick" })}>
              Choose another file
            </Button>
          </div>
        </div>
      )}

      {step.kind === "importing" && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-6 text-[15px]" role="status">
          <Loader2 className="size-4 animate-spin text-signal" aria-hidden />
          Adding items to your inbox…
        </div>
      )}

      {step.kind === "done" && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-[22px] font-semibold tracking-[-0.015em]">Imported {step.stats.created.toLocaleString()} items.</p>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            They’re in your inbox now, dated when you originally shared them. Summaries and collections fill in over the next few minutes — you can
            keep using the app.
          </p>
          <Button asChild size="lg">
            <Link href="/inbox?source=instagram">Open Instagram items</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
