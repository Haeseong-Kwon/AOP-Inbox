import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupReview } from "@/components/actions/setup-review";

export const metadata: Metadata = { title: "Review setup" };

async function Content({ params }: { params: PageProps<"/items/[id]/setup">["params"] }) {
  const { id } = await params;
  return <SetupReview itemId={id} />;
}

export default function SetupPage({ params }: PageProps<"/items/[id]/setup">) {
  return (
    <Suspense>
      <Content params={params} />
    </Suspense>
  );
}
