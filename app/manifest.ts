import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AOP Inbox",
    short_name: "AOP Inbox",
    description: "Capture once. Understand automatically. Find anything later.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#16171b",
    theme_color: "#16171b",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // Web Share Target: Instagram → Share → AOP Inbox (Android / desktop Chrome).
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
    shortcuts: [
      { name: "Capture", url: "/?capture=1" },
      { name: "Search", url: "/search" },
      { name: "Ask Inbox", url: "/ask" },
    ],
  };
}
