"use client";

import { Home, Inbox, MessageSquareText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useUI } from "./ui-store";

const ITEMS = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/inbox", label: "Inbox", icon: Inbox, match: (p: string) => p.startsWith("/inbox") || p.startsWith("/items") },
  null, // capture
  { href: "/search", label: "Search", icon: Search, match: (p: string) => p.startsWith("/search") },
  { href: "/ask", label: "Ask", icon: MessageSquareText, match: (p: string) => p.startsWith("/ask") },
] as const;

export function MobileNav() {
  const t = useT();
  const pathname = usePathname();
  const { openCapture } = useUI();
  return (
    <nav aria-label={t("Main")} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/92 backdrop-blur-md md:hidden">
      <ul className="mx-auto grid h-14 max-w-md grid-cols-5 items-center">
        {ITEMS.map((item) =>
          item === null ? (
            <li key="capture" className="flex justify-center">
              <button
                type="button"
                onClick={() => openCapture()}
                aria-label={t("Capture")}
                className="flex size-11 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform active:scale-95"
              >
                <Plus className="size-5" aria-hidden />
              </button>
            </li>
          ) : (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.match(pathname) ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-1 text-[10.5px] text-muted-foreground",
                  item.match(pathname) && "text-foreground [&_svg]:text-signal",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {t(item.label)}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
