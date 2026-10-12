import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthGate } from "@/lib/auth/gate";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <Suspense>
        <AuthGate requireOnboarded={false}>
          <OnboardingFlow />
        </AuthGate>
      </Suspense>
    </main>
  );
}
