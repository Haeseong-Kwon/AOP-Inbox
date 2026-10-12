"use client";

import { Download, Plus } from "lucide-react";
import Link from "next/link";
import { useUI } from "@/components/app/ui-store";
import { Button } from "@/components/ui/button";

export function InboxEmpty({ filtered }: { filtered: boolean }) {
  const { openCapture } = useUI();
  if (filtered) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-16 sm:px-8">
        <p className="text-[15px] font-medium">Nothing here yet.</p>
        <p className="max-w-sm text-sm text-muted-foreground">No items match this view. Try another filter, or go back to everything.</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/inbox">Show all items</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-4 px-5 py-16 sm:px-8 sm:py-24">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Your Inbox is clear.</h2>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
        Save a Reel, paste a link, or write something worth remembering.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={() => openCapture()}>
          <Plus aria-hidden /> Paste link
        </Button>
        <Button variant="outline" asChild>
          <Link href="/import">
            <Download aria-hidden /> Import Instagram history
          </Link>
        </Button>
      </div>
    </div>
  );
}
