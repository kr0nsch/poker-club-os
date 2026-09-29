import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Poker Club OS", template: "%s · Poker Club OS" },
  description: "Local-first live poker club operating system",
  manifest: "/manifest.webmanifest",
  applicationName: "Poker Club OS",
  appleWebApp: { capable: true, title: "Poker Club", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0d0e10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
