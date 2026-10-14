import type { Metadata } from "next";
import { CollectionsView } from "@/components/collections/collections-view";

export const metadata: Metadata = { title: "컬렉션" };

export default function CollectionsPage() {
  return <CollectionsView />;
}
