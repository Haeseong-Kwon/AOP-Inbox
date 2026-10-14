"use client";

import { Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { SourceIcon } from "@/components/inbox/source-icon";
import { T, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, SMART_VIEWS, SOURCE_NAV } from "./nav-config";
import { NotificationBell } from "./notification-bell";
import { useUI } from "./ui-store";

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-sidebar-foreground transition-colors duration-150",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "[&_svg]:text-signal",
      )}
    >
      {children}
    </Link>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-5 pb-1.5 text-xs font-medium text-muted-foreground/80">{children}</p>;
}

function SidebarLinks() {
  const pathname = usePathname();
  const t = useT();
  const params = useSearchParams();
  const onInbox = pathname === "/inbox";
  return (
    <>
      <nav aria-label={t("Main")} className="flex flex-col gap-0.5">
        {PRIMARY_NAV.map(({ href, label, icon: Icon, match }) => (
          <NavLink key={href} href={href} active={match(pathname) && !(href === "/inbox" && (params.get("source") || params.get("state")))}>
            <Icon aria-hidden />
            {t(label)}
          </NavLink>
        ))}
      </nav>
      <GroupLabel>{t("Sources")}</GroupLabel>
      <nav aria-label={t("Sources")} className="flex flex-col gap-0.5">
        {SOURCE_NAV.map(({ source, label }) => (
          <NavLink key={source} href={`/inbox?source=${source}`} active={onInbox && params.get("source") === source}>
            <SourceIcon type={source} />
            {t(label)}
          </NavLink>
        ))}
      </nav>
      <GroupLabel>{t("Smart views")}</GroupLabel>
      <nav aria-label={t("Smart views")} className="flex flex-col gap-0.5">
        {SMART_VIEWS.map(({ state, label, icon: Icon }) => (
          <NavLink key={state} href={`/inbox?state=${state}`} active={onInbox && params.get("state") === state}>
            <Icon aria-hidden />
            {t(label)}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

// usePathname needs a Suspense boundary on dynamic routes (Cache Components).
function SettingsLink() {
  const pathname = usePathname();
  return (
    <NavLink href="/settings" active={pathname.startsWith("/settings")}>
      <Settings aria-hidden />
      <T>Settings</T>
    </NavLink>
  );
}

export function Sidebar() {
  const t = useT();
  const { openCapture } = useUI();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 md:flex">
      <div className="flex h-14 items-center justify-between px-2.5">
        <Link href="/" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
          <Logo />
          AOP Inbox
        </Link>
        <NotificationBell />
      </div>
      <button
        type="button"
        onClick={() => openCapture()}
        className="mb-4 flex h-9 items-center gap-2 rounded-lg border bg-raised px-2.5 text-[13.5px] text-foreground/90 shadow-xs transition-colors hover:border-signal/40 hover:text-foreground"
      >
        <Plus className="size-4 text-signal" aria-hidden />
        <span className="flex-1 text-left">{t("Capture")}</span>
        <kbd className="rounded border px-1.5 font-mono text-[10.5px] text-muted-foreground">C</kbd>
      </button>
      <div className="scrollbar-none -mx-1 flex-1 overflow-y-auto px-1">
        <Suspense fallback={null}>
          <SidebarLinks />
        </Suspense>
      </div>
      <div className="border-t border-sidebar-border py-3">
        <Suspense fallback={null}>
          <SettingsLink />
        </Suspense>
      </div>
    </aside>
  );
}

export function Logo({ className }: { className?: string }) {
  // Tray with a single spark: things land here and get understood.
  return (
    <svg viewBox="0 0 20 20" className={cn("size-5", className)} aria-hidden>
      <path
        d="M2.5 11v3.5a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5V11h-4l-1.2 2h-4.6L6.5 11z"
        className="fill-none stroke-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="5.5" r="2.2" className="fill-signal" />
    </svg>
  );
}
