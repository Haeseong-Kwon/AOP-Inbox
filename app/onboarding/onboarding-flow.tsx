"use client";

import { ClipboardPaste, Download, Share } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const WAYS = [
  { icon: ClipboardPaste, title: "Paste a link", body: "Press C anywhere, paste, Enter. Reels, articles, videos, repos." },
  { icon: Share, title: "Share to AOP Inbox", body: "Install the app and pick it from Instagram’s share sheet." },
  { icon: Download, title: "Import your Instagram history", body: "Bring in every Reel you’ve sent yourself in DMs." },
];

export function OnboardingFlow() {
  const t = useT();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const reduce = useReducedMotion();

  const finish = async (to: string) => {
    setPending(true);
    await fetch("/api/me/onboarding", { method: "POST" });
    window.location.href = to;
  };

  return (
    <div className="w-full max-w-[440px]">
      <div className="mb-10 flex items-center justify-between">
        <Logo className="size-7" />
        <div className="flex gap-1.5" aria-label={t("Step {n} of 3", { n: step + 1 })}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn("h-1 w-6 rounded-full transition-colors duration-200", i <= step ? "bg-signal" : "bg-muted")} />
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: -12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance">
                {t("Everything worth keeping, in one intelligent inbox.")}
              </h1>
              <p className="text-[16px] leading-relaxed text-muted-foreground">
                {t("Save Reels, links and notes in a second. AOP Inbox summarizes, sorts and indexes them so you can find anything later — just by describing it.")}
              </p>
              <Button size="lg" className="mt-4 h-10 w-fit px-5" onClick={() => setStep(1)}>
                {t("Continue")}
              </Button>
            </div>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("Three ways in")}</h1>
              <ul className="flex flex-col gap-5">
                {WAYS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-surface">
                      <Icon className="size-4 text-signal" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-[15px] font-medium">{t(title)}</span>
                      <span className="block text-[14px] leading-relaxed text-muted-foreground">{t(body)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Button size="lg" className="mt-2 h-10 w-fit px-5" onClick={() => setStep(2)}>
                {t("Continue")}
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("Start with what you’ve already saved?")}</h1>
              <p className="text-[16px] leading-relaxed text-muted-foreground">
                {t("If you’ve been sending Reels to yourself, import them from Meta’s data download. Only the links are kept.")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="lg" className="h-10 px-5" disabled={pending} onClick={() => finish("/import")}>
                  {t("Import Instagram history")}
                </Button>
                <Button size="lg" variant="ghost" className="h-10 px-5" disabled={pending} onClick={() => finish("/")}>
                  {t("Skip for now")}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
