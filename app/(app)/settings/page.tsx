import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";
import { getAIConfig } from "@/lib/ai/config";
import { requirePageUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

async function SettingsContent() {
  const user = await requirePageUser();
  const { provider, models } = getAIConfig();
  return <SettingsView email={user.email} ai={{ provider, models }} />;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
