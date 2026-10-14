import { Shulker } from "@/components/brand/shulker";
import { T } from "@/lib/i18n/client";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <Shulker mood="sleep" size={56} />
      <h1 className="text-xl font-semibold"><T>You’re offline.</T></h1>
      <p className="max-w-xs text-[15px] text-muted-foreground"><T>AOP Inbox needs a connection to reach your saved items. It will reload when you’re back.</T></p>
    </main>
  );
}
