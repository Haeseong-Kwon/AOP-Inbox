export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-xl font-semibold">You’re offline.</h1>
      <p className="max-w-xs text-[15px] text-muted-foreground">AOP Inbox needs a connection to reach your saved items. It will reload when you’re back.</p>
    </main>
  );
}
