import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthGate } from "@/lib/auth/gate";
import { ShareCapture } from "./share-capture";

export const metadata: Metadata = { title: "Saving…" };

/**
 * PWA Web Share Target (GET). The page itself has no side effects; it saves via
 * a same-origin POST to /api/capture, so a crafted link can't save on your behalf.
 */
export default function SharePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <Suspense>
        <AuthGate requireOnboarded={false}>
          <ShareCapture />
        </AuthGate>
      </Suspense>
    </main>
  );
}
