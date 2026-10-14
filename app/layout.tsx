import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader, Silkscreen } from "next/font/google";
import { Providers } from "@/components/app/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const silkscreen = Silkscreen({ variable: "--font-silkscreen", subsets: ["latin"], weight: "400" });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "AOP Inbox", template: "%s — AOP Inbox" },
  description: "한 번 저장하면 알아서 이해하고, 언제든 다시 찾을 수 있어요.",
  applicationName: "AOP Inbox",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AOP Inbox", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1620" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${silkscreen.variable} antialiased`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
