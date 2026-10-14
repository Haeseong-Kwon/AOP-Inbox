"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Download, FileText, Home, Inbox, Layers, Link2, MessageSquareText, Moon, Search, Settings, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useUI } from "@/components/app/ui-store";
import { SourceIcon } from "@/components/inbox/source-icon";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { apiGet, qs } from "@/lib/client/api";
import type { SearchHit } from "@/lib/search/hybrid";
import type { ItemPage } from "@/lib/items/types";
import { useDebounced } from "@/lib/client/use-debounced";
import { useT } from "@/lib/i18n/client";

export function CommandPalette() {
  const t = useT();
  const { paletteOpen, setPaletteOpen, openCapture } = useUI();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const debounced = useDebounced(query.trim(), 200);

  const recent = useQuery({
    queryKey: ["palette-recent"],
    queryFn: ({ signal }) => apiGet<ItemPage>(`/api/items${qs({ sort: "viewed", limit: 6 })}`, signal),
    enabled: paletteOpen,
    staleTime: 15_000,
  });
  const search = useQuery({
    queryKey: ["palette-search", debounced],
    queryFn: ({ signal }) => apiGet<{ hits: SearchHit[] }>(`/api/search${qs({ q: debounced, log: 0 })}`, signal),
    enabled: paletteOpen && debounced.length > 1,
  });

  const run = (fn: () => void) => {
    setPaletteOpen(false);
    setQuery("");
    fn();
  };
  const go = (href: string) => run(() => router.push(href));
  const items = debounced.length > 1 ? (search.data?.hits.map((h) => h.item) ?? []) : (recent.data?.items ?? []);

  const nav: { label: string; icon: ReactNode; action: () => void; shortcut?: string; alwaysMatch?: boolean }[] = [
    { label: "Capture link", icon: <Link2 />, action: () => run(() => openCapture("link")), shortcut: "C" },
    { label: "Create note", icon: <FileText />, action: () => run(() => openCapture("note")) },
    { label: "Search Inbox", icon: <Search />, action: () => go(`/search${qs({ q: query.trim() })}`), shortcut: "/", alwaysMatch: true },
    { label: "Ask Inbox", icon: <MessageSquareText />, action: () => go(`/ask${qs({ q: query.trim() })}`), alwaysMatch: true },
    { label: "Open Home", icon: <Home />, action: () => go("/") },
    { label: "Open Inbox", icon: <Inbox />, action: () => go("/inbox") },
    { label: "Open Collections", icon: <Layers />, action: () => go("/collections") },
    { label: "Open Activity", icon: <Activity />, action: () => go("/activity") },
    { label: "Items ready to apply", icon: <Zap />, action: () => go("/inbox?state=ready") },
    { label: "Import Instagram history", icon: <Download />, action: () => go("/import") },
    { label: "Toggle theme", icon: <Moon />, action: () => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark")) },
    { label: "Settings", icon: <Settings />, action: () => go("/settings") },
  ];

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={(open) => {
        setPaletteOpen(open);
        if (!open) setQuery("");
      }}
      title={t("Command palette")}
      description={t("Search items or run a command")}
      className="top-[18%] translate-y-0 sm:max-w-xl"
    >
      <Command loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder={t("Search your inbox or type a command…")} />
      <CommandList className="max-h-[min(420px,60dvh)]">
        <CommandEmpty>{t("Nothing matches. Press Enter on “Ask Inbox” to ask instead.")}</CommandEmpty>
        {items.length > 0 && (
          <CommandGroup heading={debounced.length > 1 ? t("Items") : t("Recently viewed")}>
            {items.map((item) => (
              <CommandItem key={item.id} value={`item ${item.id} ${item.title} ${query}`} onSelect={() => go(`/inbox?item=${item.id}`)}>
                <SourceIcon type={item.sourceType} />
                <span className="truncate">{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={t("Commands")}>
          {nav.map((c) => (
            <CommandItem key={c.label} value={c.alwaysMatch ? `${t(c.label)} ${query}` : t(c.label)} onSelect={c.action}>
              {c.icon}
              {t(c.label)}
              {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
