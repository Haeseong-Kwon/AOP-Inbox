import type { Metadata } from "next";
import { ImportFlow } from "@/components/import/import-flow";

export const metadata: Metadata = { title: "Instagram 기록 가져오기" };

export default function ImportPage() {
  return <ImportFlow />;
}
