"use client";

import { useRouter } from "next/navigation";
import { ItemDetail } from "@/components/detail/item-detail";

export function ItemPageClient({ id }: { id: string }) {
  const router = useRouter();
  return (
    <div className="h-dvh pb-14 md:pb-0">
      <ItemDetail id={id} onClose={() => router.push("/inbox")} onOpenItem={(next) => router.push(`/items/${next}`)} />
    </div>
  );
}
