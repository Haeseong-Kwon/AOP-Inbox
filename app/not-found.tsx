import Link from "next/link";
import { Shulker } from "@/components/brand/shulker";
import { T } from "@/lib/i18n/client";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <Shulker mood="peek" idle watch pokeable size={56} />
      <p className="font-pixel text-[13px] text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold"><T>Nothing in this shulker box.</T></h1>
      <p className="max-w-xs text-[15px] text-muted-foreground"><T>The page you’re looking for isn’t here. It may have moved, or the link is wrong.</T></p>
      <Link href="/" className="mt-2 text-[14px] text-signal hover:underline"><T>Back to Home</T></Link>
    </main>
  );
}
