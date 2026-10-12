"use client";

import { ClipboardPaste, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useUI } from "@/components/app/ui-store";
import { SourceIcon } from "@/components/inbox/source-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { kindLabel } from "@/lib/client/format";
import { useCapture } from "@/lib/client/queries";
import { extractFirstUrl, normalizeUrl, parseUrl } from "@/lib/sources/normalize";

export function CaptureDialog() {
  const { captureOpen, setCaptureOpen, captureMode } = useUI();
  return (
    <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
      <DialogContent showCloseButton={false} className="top-[22%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Capture</DialogTitle>
        <DialogDescription className="sr-only">Paste a link or write a note. Press Enter to save.</DialogDescription>
        {captureOpen && <CaptureForm mode={captureMode} onDone={() => setCaptureOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function CaptureForm({ mode, onDone, autoFocus = true, rows = 4 }: { mode: "link" | "note"; onDone: () => void; autoFocus?: boolean; rows?: number }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const capture = useCapture();
  const router = useRouter();
  const noteRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => {
    const url = parseUrl(text) ? text.trim() : extractFirstUrl(text);
    return url ? normalizeUrl(url) : null;
  }, [text]);

  const submit = () => {
    if (!text.trim() || capture.isPending) return;
    capture.mutate(
      { input: text, note: note.trim() || undefined },
      {
        onSuccess: ({ item, duplicate }) => {
          setText("");
          setNote("");
          onDone();
          const open = { label: "Open", onClick: () => router.push(`/inbox?item=${item.id}`) };
          if (duplicate) toast("Already in your Inbox", { description: note.trim() ? "Your note was added to it." : item.title, action: open });
          else toast.success(detected ? "Saved" : "Note saved", { description: "Understanding it in the background.", action: open });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const paste = async () => {
    try {
      setText((await navigator.clipboard.readText()).trim());
    } catch {
      toast("Paste with ⌘V — clipboard access was blocked.");
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Tab" && detected && !e.shiftKey) {
            e.preventDefault();
            noteRef.current?.focus();
          }
        }}
        rows={detected ? 2 : rows}
        aria-label="Link or note"
        placeholder={mode === "note" ? "Write something worth remembering…" : "Paste anything… a Reel, a link, or a thought"}
        className="block w-full resize-none bg-transparent px-5 pt-5 pb-3 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none"
      />
      {detected && (
        <div className="flex flex-col gap-3 px-5 pb-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <SourceIcon type={detected.sourceType} className="text-signal" />
            <span className="text-foreground/85">{kindLabel(detected.sourceType, detected.contentKind ?? null)}</span>
            <span className="truncate font-mono">{detected.canonicalUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </div>
          <input
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Note (optional)"
            placeholder="Add a note — why is this worth keeping? (optional)"
            className="h-9 rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-signal/50 focus-visible:outline-none"
          />
        </div>
      )}
      <div className="flex items-center gap-2 border-t bg-surface/60 px-3 py-2.5">
        <Button type="button" variant="ghost" size="sm" onClick={paste} className="text-muted-foreground">
          <ClipboardPaste aria-hidden /> Paste
        </Button>
        <span className="flex-1" />
        <span className="hidden text-xs text-muted-foreground sm:inline">{detected ? "Tab to add a note" : "Shift ↵ for a new line"}</span>
        <Button type="submit" size="sm" disabled={!text.trim() || capture.isPending}>
          {capture.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <CornerDownLeft aria-hidden />}
          Save
        </Button>
      </div>
    </form>
  );
}
