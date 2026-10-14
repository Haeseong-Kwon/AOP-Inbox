import type { Metadata } from "next";
import { ActivityView } from "@/components/activity/activity-view";

export const metadata: Metadata = { title: "활동" };

export default function ActivityPage() {
  return <ActivityView />;
}
