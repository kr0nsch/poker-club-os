import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../..");
// In production the reverse proxy routes /api and /ws to the API directly;
// these rewrites make `next dev` / `next start` work stand-alone.
const API = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";
const isDev = process.env.NODE_ENV !== "production";

function csp(frameAncestors: string) {
  return [
    "default-src 'self'",
    // Next.js hydration uses inline scripts; no third-party script origins are allowed.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${frameAncestors.includes("telegram") ? " https://telegram.org" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws: wss:${isDev ? " http://localhost:4000 http://127.0.0.1:4000" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

const security = (frameAncestors: string) => [
  { key: "Content-Security-Policy", value: csp(frameAncestors) },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/health", destination: `${API}/health` },
      { source: "/health/:path*", destination: `${API}/health/:path*` },
    ];
  },
  async headers() {
    return [
      // Everything except the Mini App refuses to be framed (X-Frame-Options for old webviews).
      { source: "/:path((?!tg(?:/|$)).*)", headers: [...security("'none'"), { key: "X-Frame-Options", value: "DENY" }] },
      // Telegram Mini App runs inside Telegram Web's iframe.
      { source: "/tg/:path*", headers: security("'self' https://web.telegram.org https://*.telegram.org") },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default config;
