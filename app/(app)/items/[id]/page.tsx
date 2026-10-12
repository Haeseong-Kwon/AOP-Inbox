import { Suspense } from "react";
import { ItemPageClient } from "./item-page-client";

async function ItemContent({ params }: { params: PageProps<"/items/[id]">["params"] }) {
  const { id } = await params;
  return <ItemPageClient id={id} />;
}

/** Direct link to one item (used on small screens and for sharing a link to yourself). */
export default function ItemPage({ params }: PageProps<"/items/[id]">) {
  return (
    <Suspense>
      <ItemContent params={params} />
    </Suspense>
  );
}
