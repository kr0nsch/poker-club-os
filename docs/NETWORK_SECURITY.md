# Network Security

How the Venue Edge Server is exposed on the venue network, what it needs from the Internet,
and how to lock the network down. Application-level controls (authentication, CSRF, RBAC) are in
[SECURITY.md](SECURITY.md). Network set-up (DNS names, router, QR codes) is in
[LOCAL_NETWORK.md](LOCAL_NETWORK.md); installation in [EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md) and
[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md); device enrolment in [DEVICE_SETUP.md](DEVICE_SETUP.md).

Key sources: `docker-compose.yml`, `deploy/caddy/Caddyfile`, `.env.example`,
`apps/api/src/server.ts`, `apps/api/src/http/context.guard.ts`, `apps/api/src/realtime/hub.ts`,
`packages/core/src/config.ts`.

---

## 1. Principles

1. **The venue LAN is not trusted.** Players, their phones and any guest device may share the
   network. Every request is authenticated and authorised exactly as if it came from the Internet
   (`apps/api/src/http/context.ts`).
2. **Only the reverse proxy is reachable.** One HTTPS entry point (Caddy) serves the web app, the API
   and the local WebSocket.
3. **No inbound Internet connection is required.** Every Internet feature is outbound and optional;
   a WAN outage degrades Telegram, e-mail and cloud sync only ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)).

## 2. What the edge server exposes

`docker-compose.yml` publishes ports only for the `proxy` service:

| Service | Listens on | Published to the host network |
|---|---|---|
| `proxy` (Caddy 2) | 80, 443 | **yes** — `${HTTP_PORT:-80}:80`, `${HTTPS_PORT:-443}:443` |
| `api` (REST + WebSocket) | 4000 | no — internal Docker network `edge` only |
| `web` (Next.js) | 3000 | no |
| `worker` | — (no listener) | no |
| `postgres` | 5432 | no |
| `redis` | 6379 (no persistence, cache/rate limits only) | no |
| `minio` (optional `storage` profile) | 9000, 9001 | no |
| Caddy admin API | `localhost:2019` inside the proxy container | no |

Routing in `deploy/caddy/Caddyfile`: `/api/*`, `/health`, `/health/*` and `/ws` go to `api:4000`,
everything else to `web:3000`. Plain HTTP is redirected to HTTPS. The site log level is `WARN`, so
routine access entries (which would contain display/kiosk tokens in URLs) are not logged.

Unauthenticated endpoints reachable through the proxy: `/health`, `/health/live`, `/health/ready`
(component states only), `GET /api/v1/edge/status` (WAN / Telegram / sync state, no secrets), the
public player API (`/api/v1/public/*`), sign-in/sign-up/setup, display/kiosk token endpoints and
`POST /api/v1/telegram/webhook/<orgId>` (rejected unless `TELEGRAM_WEBHOOK_SECRET` is set and the
secret header matches). See [API.md](API.md).

**Bind to the LAN interface only.** Docker's short port syntax accepts a host IP, so the published
ports can be restricted to the edge server's LAN address in `.env`:

```dotenv
HTTP_PORT=192.168.10.10:80
HTTPS_PORT=192.168.10.10:443
```

This yields `192.168.10.10:80:80` / `192.168.10.10:443:443` in the Compose file. Never add
`ports:` entries for `api`, `web`, `postgres` or `redis`.

## 3. TLS certificates

TLS terminates at Caddy; the API sets no HSTS itself and trusts the proxy for it. `CADDY_TLS`
(`.env`) selects the certificate source:

| `CADDY_TLS` | Certificate | Needs Internet / inbound access | Notes |
|---|---|---|---|
| `internal` (default) | Caddy's own local CA | No | Install the root certificate on every staff device, TV and kiosk: `docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./pcos-local-root.crt` (printed by `install-edge.sh`) |
| `/certs/fullchain.pem /certs/privkey.pem` | Certificate for a real domain placed in `deploy/certs/` (mounted read-only) | No (obtain/renew it elsewhere) | Devices trust it without extra steps; renew and replace the files before expiry |
| an e-mail address | Public ACME (Let's Encrypt/ZeroSSL) | **Yes** — the name must resolve publicly and the CA must reach the server for its challenge | Contradicts the "no inbound Internet" model; prefer one of the options above |

Notes:

- `SITE_ADDRESS` is taken from `LOCAL_HOSTNAME`; only names/addresses listed there get a site and a
  certificate. Resolve that name to the edge server's LAN IP with split-horizon DNS on the router
  ([LOCAL_NETWORK.md](LOCAL_NETWORK.md)).
- Caddy sends `Strict-Transport-Security: max-age=31536000`. Once a browser has seen it, it will
  refuse to continue past certificate errors for that name, so install the internal root before
  devices go live.
- HTTPS is required in production: the session cookie is `Secure` (`COOKIE_SECURE=true`), and the
  service worker and the kiosk camera scanner need a secure context.
- Protect `caddy_data` (contains the internal CA private key) and `deploy/certs/` like any secret.

## 4. TRUST_PROXY and X-Forwarded-For

The API derives the client IP from `X-Forwarded-For` **only** when the TCP peer is in the
`TRUST_PROXY` list (proxy-addr syntax). The same list is used by Fastify (`trustProxy`) and by the
WebSocket hub (`proxyaddr` in `hub.ts`), so HTTP and WebSocket see the same client IP.

| Setting | Value |
|---|---|
| Default in code | `loopback` |
| `docker-compose.yml` (`api` service `environment`, overrides `.env`) | `loopback,172.28.0.0/24` — the Compose network; the proxy has the fixed address `172.28.0.10` |
| `.env.example` | `loopback,172.16.0.0/12` (applies when running without the Compose override) |

The client IP drives per-IP rate limits, WebSocket connection limits, the audit log `ip` column,
session metadata and the device registry. Rules:

- Never add LAN or guest subnets to `TRUST_PROXY`: any device in a trusted range can forge
  `X-Forwarded-For` and evade limits or falsify audit IPs.
- Caddy's `reverse_proxy` sets `X-Forwarded-For` from the connecting client; do not put another proxy
  in front of Caddy unless you also configure it as trusted.
- Avoid NAT between device networks and the edge server. Behind NAT all players share one IP and
  therefore one budget: 1500 API requests/min, 120 WebSocket upgrades/min, **64 concurrent WebSockets**,
  30 login attempts/5 min and 10 sign-ups/hour ([SECURITY.md](SECURITY.md#4-rate-limits)).
- `X-Forwarded-Host` is only used for the Origin comparison (§5 and CSRF), never for authorization.

## 5. WebSocket Origin checks (CSWSH)

The hub accepts upgrades on `/ws` and `/api/v1/ws` (`apps/api/src/realtime/hub.ts`):

- **Cookie-authenticated sockets** (a `pcos_session` cookie is present) must send an `Origin` whose
  host equals `Host`, the first `X-Forwarded-Host`, or a host from `ALLOWED_ORIGINS`; otherwise the
  upgrade is refused with `403`. This blocks cross-site WebSocket hijacking by a foreign page that
  would otherwise ride on the staff cookie. Tested in `tests/e2e/lan.test.ts`.
- Sockets without a cookie are anonymous (public data only) or authenticate with a display/kiosk token
  in the query string (`?display=` / `?kiosk=`); an invalid token is refused with `401`.
- Limits: 120 upgrades/min and 64 concurrent connections per IP, 8 KiB messages, 64 subscriptions per
  connection, ping every 25 s (dead sockets terminated).
- Every topic subscription is authorised individually; events are filtered by audience. Sessions are
  re-validated every 60 s; revoked sessions and revoked devices are disconnected (close codes 4401 /
  4403). Protocol details: [REALTIME.md](REALTIME.md).

Set `ALLOWED_ORIGINS` to the exact origins users type (e.g. `https://poker.club.example`); the
installer fills it from the hostname argument.

## 6. No inbound Internet: outbound connections only

Nothing on the Internet needs to connect to the venue. Outbound connections made by the edge stack:

| Destination | Purpose | When |
|---|---|---|
| `api.telegram.org` (`TELEGRAM_API_BASE`) | Bot API: long polling (`getUpdates`), `sendMessage`, `getMe` | Telegram enabled |
| `WAN_PROBE_URLS` (default `https://api.telegram.org`, `https://1.1.1.1`) | `HEAD` probe every `WAN_PROBE_INTERVAL_MS` (15 s) — any HTTP response means "online" | always (worker) |
| `CLOUD_API_URL` (`/v1/edge/events`, `/v1/edge/changes`, bearer `CLOUD_SYNC_TOKEN`) | Optional cloud sync ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)) | `CLOUD_SYNC_ENABLED=true` |
| `SMTP_HOST` | E-mail notifications | SMTP configured |
| Whatever `OFFSITE_BACKUP_COMMAND` contacts | Off-site backup copy | configured |
| ACME CA | Certificates | only with `CADDY_TLS=<email>` |
| npm registry, Docker Hub, `apt.postgresql.org` | Building/pulling images | install and update time |

Telegram runs in **`EDGE_LONG_POLLING` mode by default**: the worker opens outbound HTTPS requests to
Telegram; no port forwarding, public DNS name or webhook is needed. The alternative `CLOUD_WEBHOOK`
mode expects an external gateway to forward updates to the edge with a secret header
([TELEGRAM.md](TELEGRAM.md#3-modes)).

Clients: the web app loads no third-party resources, except the Telegram Mini App page `/tg/<org>`,
which loads `https://telegram.org/js/telegram-web-app.js` in the player's browser.

Allow these destinations in the venue firewall's egress policy if you restrict outbound traffic.

## 7. Remote access

**There is no built-in remote access.** The `remoteAccess` feature flag exists in settings (marked
"security-sensitive", confirmation required) but no code reads it.

Why the design keeps it off:

- Staff surfaces (`/admin`, `/floor`, the command endpoint) and the first-run setup would become
  reachable by anyone on the Internet, turning a LAN-only attack surface into a public one.
- Password guessing and account lockout (see [SECURITY.md](SECURITY.md#16-known-limitations)) would
  be possible from anywhere.
- Live operation does not need it: the venue works with the WAN down.

If remote staff access is required anyway, prefer a VPN into the venue network (the edge stays
unpublished) over port forwarding; never publish the API, PostgreSQL or Redis; keep
`telegramStaffCommands` off unless needed. `APP_URL` is only used to build links in Telegram
messages and e-mails (and the Mini App button); setting it does not publish anything.

## 8. Firewall recommendations

On the edge host (Ubuntu/Debian with `ufw`):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
# SSH only from the admin/staff network
sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp
# Web entry point from the venue networks (staff + guest Wi-Fi)
sudo ufw allow from 192.168.10.0/24 to any port 80,443 proto tcp
sudo ufw allow from 192.168.20.0/24 to any port 80,443 proto tcp
sudo ufw enable
```

**Docker caveat:** ports published by Docker are forwarded through Docker's own iptables chains and
are **not filtered by ufw's INPUT rules**. Use one or both of:

1. Bind the published ports to the LAN address (`HTTP_PORT=192.168.10.10:80`,
   `HTTPS_PORT=192.168.10.10:443`, §2).
2. Filter in the `DOCKER-USER` chain, keeping replies to the containers' own outbound connections:

   ```bash
   sudo iptables -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
   sudo iptables -I DOCKER-USER 2 -i eth0 ! -s 192.168.0.0/16 -m conntrack --ctstate NEW -j DROP
   ```

   Adapt interface and subnets, and persist the rules (e.g. `iptables-persistent`).

On the venue router: no port forwards to the edge server; allow guest Wi-Fi → edge `80,443/tcp`
only; allow the edge's outbound HTTPS (§6).

## 9. Wi-Fi segmentation

Players use the same web application on the same host and port as staff, so segmentation cannot
separate player and staff surfaces — authentication does that. Segmentation limits who can reach
staff devices and the edge host.

| Segment | Devices | Access to the edge | Other rules |
|---|---|---|---|
| Staff / operations (hidden SSID, WPA2/WPA3 with a strong key or Enterprise) | Floor and dealer tablets, cashier, registration desk, admin PCs | 80/443; SSH only from admin PCs | Not shared with players; rotate the key when staff leave |
| Devices | TV displays, kiosks | 80/443 | No client-to-client traffic needed |
| Guest / players | Player phones | 80/443 only | Client isolation on; no access to other segments |
| Server (wired) | Edge server | — | Static IP, DNS name via split-horizon ([LOCAL_NETWORK.md](LOCAL_NETWORK.md)) |

Route between segments without NAT (§4) and make `LOCAL_HOSTNAME` resolve to the edge in every
segment.

## 10. Device revocation

| Action | Where | Effect |
|---|---|---|
| Revoke device | `/admin/devices` (`device.manage`) | Sessions bound to that device ID revoked; staff requests with its ID refused (`DEVICE_REVOKED`); its staff WebSockets closed; trusted label cleared |
| Disconnect device | `/admin/devices` | Its sessions revoked and sockets closed; staff may sign in again |
| Restore device | `/admin/devices` | Revocation lifted; stays untrusted until marked trusted |
| Revoke display/kiosk link | `/admin/displays` (`display.manage`) | The token stops working for HTTP immediately; an already open WebSocket keeps receiving public events until it reconnects |
| Disable staff member / set new password / change roles | `/admin/staff` (`staff.manage`) | All the user's sessions in the organization revoked, sockets closed |
| Unlink Telegram | Player: `/p/<org>/me`; staff: `DELETE /api/v1/telegram/link` (no staff UI) | Bot no longer acts for that Telegram account |

Device IDs are generated by the browser; they are audit context, not credentials
([SECURITY.md](SECURITY.md#10-device-identity-display-and-kiosk-tokens)).

## 11. If a tablet is stolen

1. **Revoke the device** on `/admin/devices` (find it by name, type, last user, last IP). This ends
   every session created on it and closes its live connections.
2. **Reset the passwords** of staff who used it (`/admin/staff` → new password, which also revokes
   their sessions) and ask them to sign in again elsewhere.
3. If it was a **TV or kiosk**, revoke its link on `/admin/displays` and create a new one for the
   replacement device. To cut an open socket immediately, restart the API
   (`docker compose restart api`); other devices reconnect automatically.
4. If the device was a staff member's phone with a linked Telegram account, set the membership to
   `DISABLED` (staff commands then stop working for that account) or remove the link.
5. If the device stored the staff Wi-Fi key, **rotate the staff Wi-Fi key**.
6. Review `/admin/audit` filtered by the device's users and time range for unexpected actions;
   undo or correct them with reasons.

What an attacker gets from the device itself: an `HttpOnly` session cookie (useless once revoked),
the device ID, device type and UI language in `localStorage`, and the cached application shell. No
API data is cached by the service worker. A display/kiosk device holds its token in the URL.
