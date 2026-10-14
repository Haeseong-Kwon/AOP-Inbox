"use client";

import { useEffect, useRef, useState } from "react";
import { useUpdateItem } from "@/lib/client/queries";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export const EDIT_NOTE_EVENT = "aop:edit-note";

interface NoteEditorProps {
  itemId: string;
  initial: string | null;
}

/** Plain-text note. Saves on blur or ⌘↵; `E` anywhere focuses it. */
export function NoteEditor({ itemId, initial }: NoteEditorProps) {
  const [value, setValue] = useState(initial ?? "");
  const [savedValue, setSavedValue] = useState(initial ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const update = useUpdateItem();
  const t = useT();
  const dirty = value.trim() !== savedValue.trim();

  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
    };
    window.addEventListener(EDIT_NOTE_EVENT, focus);
    return () => window.removeEventListener(EDIT_NOTE_EVENT, focus);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [value]);

  const save = () => {
    if (!dirty) return;
    const next = value.trim();
    update.mutate({ id: itemId, patch: { userNote: next || null } }, { onSuccess: () => setSavedValue(next) });
  };

  return (
    <div>
      <label htmlFor={`note-${itemId}`} className="sr-only">
        {t("My note")}
      </label>
      <textarea
        id={`note-${itemId}`}
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            ref.current?.blur();
          }
        }}
        placeholder={t("Why did you save this? Where will you use it?")}
        className={cn(
          "w-full resize-none rounded-lg border bg-surface px-3.5 py-3 text-[14.5px] leading-relaxed transition-colors outline-none",
          "placeholder:text-muted-foreground/70 focus:border-signal/50 focus:bg-background focus-visible:outline-none",
        )}
      />
      <p className="mt-1.5 h-4 text-xs text-muted-foreground" aria-live="polite">
        {update.isPending ? t("Saving…") : dirty ? t("⌘↵ to save") : savedValue && update.isSuccess ? t("Saved. Your note now shapes search and Ask.") : ""}
      </p>
    </div>
  );
}
