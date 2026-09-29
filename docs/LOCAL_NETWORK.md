# Venue local network

Poker Club OS is local-first. One **Venue Edge Server** on the club's LAN runs PostgreSQL, the API,
the worker, the web app and the Caddy reverse proxy ([ARCHITECTURE.md](ARCHITECTURE.md)). Every
tablet, TV, kiosk and player phone talks only to that server. The Internet is only used for
Telegram, e-mail, the optional cloud sync and off-site backup copies
([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)).

This document describes how to lay out the venue network so that devices find the edge server by
name, trust its HTTPS certificate and keep working when the Internet is down. Firewall hardening
details are in [NETWORK_SECURITY.md](NETWORK_SECURITY.md).

## 1. Reference topology

```
                 Internet (optional)
                        │
                ┌───────┴────────┐
                │ Router/firewall│  DHCP, local DNS, inter-VLAN rules
                └──┬──────────┬──┘
     VLAN 10 STAFF │          │ VLAN 20 GUEST
   192.168.10.0/24 │          │ 192.168.20.0/24
          ┌────────┴───┐   ┌──┴───────────────┐
          │  Switch    │   │ AP SSID          │
          │  (PoE)     │   │ "Club-Guest"     │
          └┬────┬────┬─┘   │ client isolation │
           │    │    │     └──┬───────────────┘
   Edge server  │  AP SSID "Club-Staff"      players' phones
 192.168.10.10  │   tablets, dealer tablets,
   (wired)      │   floor phones
           TVs / kiosk (wired where possible)
```

Example addresses are used throughout this document; any private range works.

| Element | Recommendation |
| --- | --- |
| Edge server | Wired Gigabit Ethernet, never Wi-Fi. Fixed address (DHCP reservation or static), e.g. `192.168.10.10` |
| Local name | e.g. `poker.myclub.example`, resolving to the edge server's IP on every venue network that must reach it |
| Staff network | Own VLAN and SSID for tablets, dealer tablets, TVs, kiosk, admin PCs |
| Guest network | Separate VLAN and SSID for players; may reach the edge server on TCP 80/443 only |
| Power | Router, switch and access points on the same UPS as the edge server ([EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md#power-and-ups)) |

## 2. Reserved IP address for the edge server

1. Connect the edge server to the staff VLAN with a cable.
2. In the router's DHCP settings create a **static lease / DHCP reservation** for the edge server's MAC
   address (or configure a static IP on the server outside the DHCP pool).
3. Reboot the server once and confirm it comes back with the same address (`ip -4 addr` on Ubuntu).

Everything else (DNS record, firewall rules, the certificate site address) depends on this address
never changing.

## 3. Local DNS name

Staff should never type IP addresses. Pick one name and make it resolve to the edge server:

| Option | How | Works on | Notes |
| --- | --- | --- | --- |
| **A. Router / local DNS record (recommended)** | Add a host override `poker.myclub.example → 192.168.10.10` in the router's DNS (dnsmasq, Unbound, pfSense/OPNsense host override, etc.) | All devices that use the router as DNS server | Use a name under a domain the club owns (or a name that is not publicly registered). Devices must get the router as DNS server via DHCP |
| B. Public DNS record to a private IP | Create `poker.myclub.example A 192.168.10.10` at the club's DNS provider | All devices, even with DNS-over-HTTPS | Needs the Internet for the first lookup (cached afterwards); many routers block such answers ("DNS rebind protection") unless the domain is whitelisted |
| C. mDNS `.local` | The compose default site address is `poker.local`. Publishing it needs an mDNS responder on the host (for example `avahi-daemon` with the host name `poker`) | Apple devices, Windows 10+, most Linux; not reliable on every Android device | Not configured by this repository. mDNS does not cross VLANs without a reflector. Apple devices resolve `.local` only via mDNS, so a router DNS record for `poker.local` does not help them |
| D. `hosts` file | Add `192.168.10.10 poker.myclub.example` on fixed PCs | Only that PC | Fallback for admin PCs; not practical for phones |

The same name must be configured in **three** places:

| Where | Setting | Effect |
| --- | --- | --- |
| `.env` on the edge server | `LOCAL_HOSTNAME=poker.myclub.example` (compose passes it to Caddy as `SITE_ADDRESS`), `LOCAL_APP_URL=https://poker.myclub.example`, `ALLOWED_ORIGINS=https://poker.myclub.example` | The name Caddy serves and issues a certificate for. `deploy/scripts/install-edge.sh <hostname>` sets all three |
| First-run wizard / **Admin → Settings → Venues** | Venue *Local hostname* (and optional *Local address (URL)*) | Drives the QR codes on **Admin → Local network**, display and kiosk links |
| Router / DNS | Record from the table above | Devices find the server |

If the venue hostname and `LOCAL_HOSTNAME` differ, the QR codes point to a name Caddy has no
certificate for and devices get a TLS error.

## 4. HTTPS on the LAN

All traffic goes through Caddy on TCP 443 ([deploy/caddy/Caddyfile](../deploy/caddy/Caddyfile)); plain
HTTP on port 80 is redirected to HTTPS. Session cookies are `Secure` (`COOKIE_SECURE=true`), and the
PWA service worker, screen wake lock and camera scanning need a secure, trusted origin, so HTTPS is
not optional.

| `CADDY_TLS` value | Certificate | Device preparation |
| --- | --- | --- |
| `internal` (default) | Issued by Caddy's own local CA, renewed automatically, works with no Internet | Install the Caddy root certificate on every staff device ([DEVICE_SETUP.md](DEVICE_SETUP.md#trusting-the-local-certificate)) |
| `/certs/fullchain.pem /certs/privkey.pem` | A certificate for the club's real domain, copied into `deploy/certs/` | None. Renewal is manual (copy new files, restart `proxy`) |
| an e-mail address | ACME (public CA) | Only if the hostname is publicly resolvable and reachable from the Internet; not recommended for a LAN-only server ([DEPLOYMENT.md](DEPLOYMENT.md#tls-options)) |

Export the internal root certificate once after installation:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./pcos-local-root.crt
```

Things to know about the internal CA:

- The CA lives in the `caddy_data` Docker volume. If that volume is lost (new server, `docker compose
  down -v`), Caddy creates a new CA and **every device has to trust the new root again**. Keep a copy
  of the CA directory ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md#what-is-and-is-not-in-a-backup)).
- Caddy sends `Strict-Transport-Security: max-age=31536000`. Once a browser has loaded the site with a
  trusted certificate, it refuses plain HTTP and offers no "proceed anyway" on certificate errors for
  that name for a year. If the CA ever changes, such devices are locked out until they trust the new
  root.
- Players' phones are usually not prepared with the root certificate. They see a browser warning on
  the local player pages; see [DEVICE_SETUP.md](DEVICE_SETUP.md#players-phones) for the options.

## 5. VLANs and SSIDs

| Network | Members | May reach | Must not reach |
| --- | --- | --- | --- |
| STAFF (VLAN 10, SSID `Club-Staff`, WPA2/WPA3 with a strong key) | Edge server, TD/floor tablets and phones, dealer tablets, registration/cashier PCs, TVs, kiosk | Edge server TCP 80/443; Internet (optional) | Guest devices |
| GUEST (VLAN 20, SSID `Club-Guest`, client isolation on) | Players' phones, visitors | Edge server TCP 80/443 **only if** players should use the local player pages; Internet | Everything else on VLAN 10 (tablets, TVs, SSH, router admin) |
| MGMT (optional VLAN 30) | Router, switch, AP management, admin laptop | Everything | – |

Rules of thumb:

- The **kiosk and TVs belong on the staff network**. Their secret links (`/display/<token>`,
  `/kiosk/<token>`) are the only credential they have.
- Do not put staff tablets on the guest SSID "because it is simpler": the guest network is where an
  attacker would sit ([SECURITY.md](SECURITY.md)).
- Players reach the edge server across VLANs through the router, so guest **client isolation is fine**
  (it only blocks phone-to-phone traffic).
- If guests must not use local pages at all, block guest → edge and rely on Telegram / the public URL
  (`APP_URL`) instead; the local system is unaffected.

## 6. Ports

| Port | Where | Purpose |
| --- | --- | --- |
| TCP 443 | Edge host (`HTTPS_PORT`, default 443) | Web app, API (`/api/*`), health (`/health*`), WebSocket (`/ws`) |
| TCP 80 | Edge host (`HTTP_PORT`, default 80) | Redirect to HTTPS (and ACME HTTP challenge if ACME is used) |
| TCP 22 | Edge host (OS) | SSH for administration; allow only from MGMT/STAFF |
| UDP 5353 | Edge host (only with Avahi) | mDNS, if option C is used |
| 4000, 3000, 5432, 6379, 9000/9001 | Docker network `edge` only | API, web, PostgreSQL, Redis, MinIO. Not published on the LAN |
| 2019 | Inside the `proxy` container | Caddy admin API, bound to `localhost` |

Keep 80/443: Caddy redirects to the standard HTTPS port. Note that ports published by Docker are
inserted into iptables by Docker itself and are not filtered by `ufw` rules on the host; enforce
"who may reach the edge server" on the router between VLANs.

## 7. What stays local and what needs the Internet

| Traffic | Stays on the LAN | Needs the Internet |
| --- | --- | --- |
| Staff console, floor, dealer, admin (HTTPS + WebSocket) | yes | – |
| TV displays, kiosk, player pages on venue Wi-Fi | yes | – |
| Tournament clock, seating, registration, results, audit, backups to local disk | yes | – |
| WAN probe: `HEAD` to `WAN_PROBE_URLS` (default `https://api.telegram.org`, `https://1.1.1.1`) every `WAN_PROBE_INTERVAL_MS` (15 s) | – | outbound HTTPS |
| Telegram bot and notifications (`TELEGRAM_API_BASE`, default `https://api.telegram.org`, long polling) | – | outbound HTTPS only, no inbound port |
| Cloud sync (`CLOUD_API_URL`) | – | outbound HTTPS ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)) |
| E-mail (`SMTP_HOST:SMTP_PORT`) | – | outbound SMTP |
| Off-site backup copy (`OFFSITE_BACKUP_COMMAND`) | – | whatever the command contacts |
| Telegram Mini App, links in Telegram/e-mail (`APP_URL`) | – | a public URL (not provided by the edge server) |
| Installing / updating the software (Docker Hub, npm registry, apt.postgresql.org), OS updates, NTP | – | during maintenance only |

The web app loads no third-party scripts, fonts or images (its Content-Security-Policy allows only
`'self'`), so a phone on a guest network without Internet can still use the local pages.

## 8. IP fallback URL

**Admin → Local network** shows an *IP fallback* (`https://<ip>`) for devices on which the name does
not resolve. Treat it as a last resort:

- Caddy only has certificates for the site addresses in `LOCAL_HOSTNAME`. To serve the IP as well, list
  it there, as the Caddyfile comment suggests: `LOCAL_HOSTNAME=poker.myclub.example, 192.168.10.10`
  (then `docker compose up -d proxy`). Enter only the host name in the venue settings.
- Even then the device must trust the internal root certificate, and cookies and the installed PWA are
  bound to the address used, so a device that switches between name and IP signs in twice.
- Under Docker Compose the page currently derives the address from the API container, so it shows the
  internal Docker address (`172.28.0.x`), not the server's LAN IP. Use the reserved LAN IP from
  section 2 instead.

Test the fallback once during installation from a staff tablet.

## 9. Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Name does not resolve on some phones | Device uses its own DNS: Android *Private DNS* with a provider host name, browser "secure DNS" with a custom provider, hard-coded 8.8.8.8 | Set Private DNS to *Off/Automatic* on venue devices; disable custom secure DNS in the browser; use option B (public record) if you cannot control phones |
| Name resolves to nothing although the router has the record | Router DNS rebind protection drops private answers for public domains | Whitelist the domain (e.g. dnsmasq `rebind-domain-ok`, "DNS rebind protection exceptions" on consumer routers) |
| Tablet shows "Local server unreachable" while the Wi-Fi icon is fine | Captive portal / "no Internet" detection made the OS route traffic over mobile data | No captive portal on the staff SSID; disable *Wi-Fi Assist* (iOS) / *Switch to mobile data* / *Adaptive connectivity* (Android) on venue devices |
| Players cannot open local pages from the guest Wi-Fi | Guest captive portal blocks everything before acceptance | Add the edge server's IP and host name to the portal's walled garden, or give up local player pages for guests |
| Devices on the same SSID as the edge cannot reach it | "AP isolation" on an SSID that also carries wired LAN hosts | Keep the edge server on the routed staff VLAN; enable isolation only on the guest SSID |
| Many players suddenly get "too many requests" | Guest network NATed to one address in front of the edge server | Route, do not NAT, between VLANs. The API limits each client IP to 1 500 requests/min, 120 WebSocket connects/min and 64 concurrent WebSocket connections |
| Certificate error after replacing the server | New Caddy CA | Restore the CA directory or re-trust the new root on all devices |
| TVs drift or clocks look wrong | Edge server system time is wrong (clients show server time) | Enable NTP on the host; check the RTC battery ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md#edge-server-power-loss)) |

## 10. Verification checklist

- [ ] Edge server has the same IP after a reboot.
- [ ] `nslookup poker.myclub.example` on a staff tablet and on a guest phone returns the edge IP.
- [ ] `https://poker.myclub.example/health` opens on a staff tablet without a certificate warning.
- [ ] A guest phone cannot open the router admin page, SSH or a staff tablet's address.
- [ ] With the WAN cable unplugged, **Admin → Local network → Edge status** shows *Internet: Offline*
      within about a minute and tournaments keep working ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)).
- [ ] QR codes on **Admin → Local network** show `https://poker.myclub.example/...`.
