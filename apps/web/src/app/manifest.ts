import type { MetadataRoute } from "next";

// Installable player app (spec §76). Everything is served by the venue edge
// server; the icon is a local SVG (no external assets).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poker Club",
    short_name: "Poker Club",
    description: "Tournaments, live clock, seating and registration at your poker club",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07100d",
    theme_color: "#07100d",
    categories: ["games", "entertainment", "sports"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
