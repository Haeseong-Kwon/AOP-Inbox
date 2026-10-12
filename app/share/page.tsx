import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { AuthGate } from "@/lib/auth/gate";
import { ShareCapture } from "./share-capture";

export const metadata: Metadata = { title: "Saving…" };

/**
 * PWA Web Share Target (GET). The OS share sheet navigates here with
 * Sec-Fetch-Site: none, so we save straight away. Anything else — a link on some
 * other site, or the same-origin hop back from /login — gets an explicit "Save"
 * button, so a crafted URL can't silently put content into your inbox.
 */
async function ShareGate() {
  const site = (await headers()).get("sec-fetch-site");
  return (
    <AuthGate requireOnboarded={false}>
      <ShareCapture autoSave={site === "none"} />
    </AuthGate>
  );
}

export default function SharePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <Suspense>
        <ShareGate />
      </Suspense>
    </main>
  );
}
