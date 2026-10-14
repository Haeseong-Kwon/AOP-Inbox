import type { Metadata } from "next";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "인박스" };

export default function InboxPage() {
  return <InboxView />;
}
