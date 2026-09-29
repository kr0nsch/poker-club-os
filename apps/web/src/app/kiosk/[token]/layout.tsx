import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Self check-in",
  robots: { index: false, follow: false },
};

// Touch kiosk: no pinch-zoom, no accidental scaling.
export const viewport: Viewport = {
  themeColor: "#0d0e10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function KioskLayout({ children }: { children: ReactNode }) {
  return children;
}
