"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/lib/client/api";
import { keys, useCollections } from "@/lib/client/queries";
import { useT } from "@/lib/i18n/client";

export function CollectionsView() {
  const { data, isLoading, isError, error } = useCollections();
  const qc = useQueryClient();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ai = data?.filter((c) => c.kind !== "manual") ?? [];
  const manual = data?.filter((c) => c.kind === "manual") ?? [];

  const create = async () => {
    if (!name.trim()) return;
    try {
      await apiSend("/api/collections", "POST", { name: name.trim() });
      setName("");
      setCreating(false);
      void qc.invalidateQueries({ queryKey: keys.collections });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <header className="flex flex-col gap-1.5 pb-10">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("Collections")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("Sorted for you as things arrive. Add your own when you want a specific shelf.")}</p>
      </header>

      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-muted/40" aria-hidden />}
      {isError && <p className="text-sm text-muted-foreground">{error.message}</p>}

      {data && ai.length === 0 && (
        <p className="pb-10 text-[15px] text-muted-foreground">{t("Collections appear automatically once your first items are understood.")}</p>
      )}

      {ai.length > 0 && (
        <ul className="flex flex-col divide-y border-y">
          {ai.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:gap-8">
              <Link href={`/inbox?collection=${c.id}`} className="group flex w-full shrink-0 items-baseline justify-between gap-3 sm:w-56 sm:flex-col sm:justify-start sm:gap-1">
                <span className="text-[17px] font-semibold tracking-[-0.01em] group-hover:text-signal">{t(c.name)}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {t(c.count === 1 ? "{n} item" : "{n} items", { n: c.count })}
                </span>
              </Link>
              {c.children.length > 0 && (
                <div className="flex flex-wrap content-start gap-1.5">
                  {c.children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/inbox?collection=${child.id}`}
                      className="inline-flex items-center gap-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-[13px] text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {child.name}
                      <span className="text-xs text-muted-foreground tabular-nums">{child.count}</span>
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="pt-12" aria-labelledby="manual-title">
        <div className="flex items-center justify-between pb-3">
          <h2 id="manual-title" className="text-[15px] font-semibold">
            {t("Your collections")}
          </h2>
          {!creating && (
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t("New collection")}
            </Button>
          )}
        </div>
        {creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="mb-4 flex gap-2"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              maxLength={60}
              placeholder={t("e.g. AOP launch ideas")}
              aria-label={t("Collection name")}
              className="h-9 flex-1 rounded-md border bg-surface px-3 text-sm outline-none focus:border-signal/50"
            />
            <Button type="submit" size="lg" disabled={!name.trim()}>
              {t("Create")}
            </Button>
          </form>
        )}
        {manual.length === 0 && !creating ? (
          <p className="text-sm text-muted-foreground">{t("None yet. Open any item and choose “Add to collection”.")}</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {manual.map((c) => (
              <li key={c.id}>
                <Link href={`/inbox?collection=${c.id}`} className="flex items-center justify-between rounded-md px-2 py-2 text-[14.5px] hover:bg-accent/70">
                  {c.name}
                  <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
