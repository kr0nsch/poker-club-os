import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Display",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050b09",
  width: "device-width",
  initialScale: 1,
};

export default function DisplayLayout({ children }: { children: ReactNode }) {
  return children;
}
