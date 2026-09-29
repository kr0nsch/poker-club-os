/* Poker Club OS service worker (spec §76).
 *
 * Caches only the application shell. API data, the realtime WebSocket and
 * health checks are never intercepted: the edge server on the venue LAN is
 * always the source of truth, and a stale tournament state is worse than an
 * honest "reconnecting" indicator.
 */

const VERSION = "pcos-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg"];
const MAX_STATIC_ENTRIES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best effort: a missing entry must not block installation.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* offline during install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("pcos-") && !n.startsWith(`${VERSION}-`)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

function bypass(url) {
  const p = url.pathname;
  return p === "/api" || p.startsWith("/api/") || p === "/ws" || p.startsWith("/ws/") || p.startsWith("/health");
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") await cache.put(request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match("/"));
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poker Club</title>' +
        '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#07100d;color:#e8f1ec;font-family:system-ui,sans-serif;text-align:center">' +
        "<div><div style=\"font-size:48px\">&#9824;</div><p>The local server is unreachable.<br>Check the venue Wi-Fi and try again.</p>" +
        '<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#22c55e;color:#04130a">Retry</button></div></body>',
      { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (bypass(url) || request.headers.get("upgrade") === "websocket") return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
  // Everything else (RSC payloads, manifest, sw.js itself) goes straight to the network.
});
