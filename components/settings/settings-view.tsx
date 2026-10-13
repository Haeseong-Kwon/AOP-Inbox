import Link from "next/link";
import type { ReactNode } from "react";
import { SHORTCUTS } from "@/components/app/shortcut-list";
import { Button } from "@/components/ui/button";
import type { AIConfig } from "@/lib/ai/config";
import { AgentSettings, NotificationSettings } from "./agent-settings";
import { InstallButton, SignOutButton, ThemePicker } from "./settings-client";

function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b py-8 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-10">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3">{children}</div>
    </section>
  );
}

interface SettingsViewProps {
  email: string;
  ai: Pick<AIConfig, "provider" | "models">;
}

export function SettingsView({ email, ai }: SettingsViewProps) {
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pt-8 pb-28 sm:px-8 md:pt-14 md:pb-16">
      <h1 className="pb-2 text-[26px] font-semibold tracking-[-0.02em]">Settings</h1>

      <Block title="Account">
        <p className="text-[15px]">{email}</p>
        <SignOutButton />
      </Block>

      <Block title="Appearance">
        <ThemePicker />
      </Block>

      <Block title="Capture" description="Fastest ways to get things in.">
        <ul className="flex flex-col gap-2 text-[14.5px] leading-relaxed">
          <li>Press C anywhere, paste, and hit Enter.</li>
          <li>Install the app, then share a Reel straight to AOP Inbox from Instagram (Android and desktop Chrome).</li>
          <li>On iPhone, copy the Reel link and open AOP Inbox — Capture has a Paste button.</li>
        </ul>
        <InstallButton />
      </Block>

      <Block title="Local Agent" description="Runs approved setups on your Mac — dry run first, snapshots before changes, verified, undoable.">
        <div id="agent" className="w-full">
          <AgentSettings />
        </div>
      </Block>

      <Block title="Notifications" description="In-app, quietly.">
        <NotificationSettings />
      </Block>

      <Block title="Import" description="Bring in links you’ve already sent yourself.">
        <Button variant="outline" asChild>
          <Link href="/import">Import Instagram history</Link>
        </Button>
      </Block>

      <Block title="AI" description="Configured on the server with environment variables.">
        {ai.provider === "mock" ? (
          <p className="text-[14.5px] leading-relaxed">
            Running in offline mode. Summaries and search use local heuristics. Set <code className="font-mono text-[13px]">AI_API_KEY</code> to
            enable full analysis and Ask Inbox answers.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
            <dt className="text-muted-foreground">Provider</dt>
            <dd>{ai.provider}</dd>
            <dt className="text-muted-foreground">Analysis</dt>
            <dd className="font-mono text-[13px]">{ai.models.fast}</dd>
            <dt className="text-muted-foreground">Ask Inbox</dt>
            <dd className="font-mono text-[13px]">{ai.models.strong}</dd>
            <dt className="text-muted-foreground">Embeddings</dt>
            <dd className="font-mono text-[13px]">{ai.models.embedding}</dd>
          </dl>
        )}
      </Block>

      <Block title="Keyboard shortcuts" description="Shortcuts pause while you type in a field.">
        <dl className="grid w-full max-w-sm grid-cols-[1fr_auto] gap-y-2 text-[14px]">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>{s.action}</dt>
              <dd>
                <kbd className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">{s.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block title="Privacy">
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">
          AOP Inbox never asks for your Instagram password and never reads your DMs. Imports keep only links and dates. Instagram pages are not
          scraped; previews use Meta’s official oEmbed only when configured.
        </p>
      </Block>
    </div>
  );
}
