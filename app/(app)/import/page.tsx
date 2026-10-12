import type { Metadata } from "next";
import { ImportFlow } from "@/components/import/import-flow";

export const metadata: Metadata = { title: "Import Instagram history" };

export default function ImportPage() {
  return <ImportFlow />;
}
