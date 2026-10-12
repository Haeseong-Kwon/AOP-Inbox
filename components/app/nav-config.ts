import { Clock3, Compass, Home, Inbox, Layers, MessageSquareText, Search, Sparkles, Star, Zap } from "lucide-react";
import type { SourceType } from "@/db/schema";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/inbox", label: "Inbox", icon: Inbox, match: (p: string) => p.startsWith("/inbox") || p.startsWith("/items") },
  { href: "/search", label: "Search", icon: Search, match: (p: string) => p.startsWith("/search") },
  { href: "/collections", label: "Collections", icon: Layers, match: (p: string) => p.startsWith("/collections") },
  { href: "/ask", label: "Ask Inbox", icon: MessageSquareText, match: (p: string) => p.startsWith("/ask") },
] as const;

export const SOURCE_NAV: { source: SourceType; label: string }[] = [
  { source: "instagram", label: "Instagram" },
  { source: "web", label: "Web" },
  { source: "note", label: "Notes" },
];

export const SMART_VIEWS = [
  { state: "unread", label: "Unread", icon: Clock3 },
  { state: "favorite", label: "Favorites", icon: Star },
  { state: "high-value", label: "High value", icon: Sparkles },
  { state: "actionable", label: "Actionable", icon: Zap },
] as const;

export const BrowseIcon = Compass;
