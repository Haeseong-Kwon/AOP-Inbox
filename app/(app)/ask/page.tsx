import type { Metadata } from "next";
import { AskView } from "@/components/ask/ask-view";

export const metadata: Metadata = { title: "인박스에 묻기" };

export default function AskPage() {
  return <AskView />;
}
