import { Suspense } from "react";
import { MobileNav } from "@/components/app/mobile-nav";
import { GlobalShortcuts } from "@/components/app/shortcuts";
import { Sidebar } from "@/components/app/sidebar";
import { UIProvider } from "@/components/app/ui-store";
import { CaptureDialog } from "@/components/capture/capture-dialog";
import { CommandPalette } from "@/components/command/command-palette";
import { AuthGate } from "@/lib/auth/gate";

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-14 sm:px-8" aria-hidden>
      <div className="h-7 w-48 rounded bg-muted" />
      <div className="mt-4 h-4 w-72 rounded bg-muted/60" />
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <UIProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1">
          <Suspense fallback={<PageFallback />}>
            <AuthGate>{children}</AuthGate>
          </Suspense>
        </main>
      </div>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
      <CaptureDialog />
      <CommandPalette />
      <GlobalShortcuts />
    </UIProvider>
  );
}
