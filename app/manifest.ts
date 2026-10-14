import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AOP Inbox",
    short_name: "AOP Inbox",
    description: "셜커박스에 던져 두면 알아서 이해하고 정리해요.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1a1620",
    theme_color: "#1a1620",
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
      { name: "저장", url: "/?capture=1" },
      { name: "검색", url: "/search" },
      { name: "인박스에 묻기", url: "/ask" },
    ],
  };
}
