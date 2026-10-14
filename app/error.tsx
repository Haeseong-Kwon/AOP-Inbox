"use client";

import Link from "next/link";
import { Shulker } from "@/components/brand/shulker";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/** Any page that throws: the shulker shakes its shell, and you can retry. */
export default function RouteError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Shulker mood="no" pokeable size={56} title={t("Shulker")} />
      <h1 className="text-xl font-semibold">{t("The shulker dropped this page.")}</h1>
      <p className="max-w-xs text-[15px] text-muted-foreground">{t("Something broke while loading it. Try again, or head back to Home.")}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => retry()}>{t("Try again")}</Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/">{t("Back to Home")}</Link>
        </Button>
      </div>
    </main>
  );
}
