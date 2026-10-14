import type { Metadata } from "next";
import { SearchView } from "@/components/search/search-view";

export const metadata: Metadata = { title: "검색" };

export default function SearchPage() {
  return <SearchView />;
}
