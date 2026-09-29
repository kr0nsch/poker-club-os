# Offline operation

Poker Club OS is built so that **losing the Internet never stops a tournament**. Everything a venue
needs runs on the edge server on the local network ([ARCHITECTURE.md](ARCHITECTURE.md),
[LOCAL_NETWORK.md](LOCAL_NETWORK.md)). A missing WAN connection is reported as *degraded*, never as
*down*. This document explains what keeps working, what waits, how staff see it, what happens when the
Internet comes back, and what happens when the edge server itself loses power.

## What works with no Internet

Everything local, with the same speed as online:

| Area | Examples |
| --- | --- |
| Tournament operations | Registration, check-in, seat draw, moves and balancing, clock (pause, resume, levels, breaks), eliminations, rebuys/add-ons, results, undo ([TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md), [SEATING_ENGINE.md](SEATING_ENGINE.md)) |
| Staff surfaces | `/admin`, `/floor`, `/dealer`, registration desk, cashier flows, audit log, reports |
| Venue screens | TV displays (`/display/<token>`), self check-in kiosk (`/kiosk/<token>`) |
| Players on venue Wi-Fi | `/p/<club>`: schedule, registration, check-in QR code, live clock, own seat, in-app inbox |
| Realtime | Every committed change reaches connected devices over the local WebSocket ([REALTIME.md](REALTIME.md)) |
| Operations | Device registry, health page, local backups (`pg_dump` to the server disk) |

No page loads third-party scripts, fonts or images, so nothing in the browser depends on the Internet
either.

## What degrades

| Feature | While offline | After the Internet returns |
| --- | --- | --- |
| Telegram notifications to players and staff | Queued as `PENDING`; each expires at its TTL | Still-valid ones are sent once; expired ones never |
| Telegram bot (long polling, commands, registration via bot) | Not reachable for players; polling retries with back-off | Polling resumes immediately ([TELEGRAM.md](TELEGRAM.md)) |
| E-mail (SMTP, only if `SMTP_HOST` is set) | Queued like Telegram messages | Delivered if not expired |
| Cloud sync (optional) | Events accumulate in the outbox | Pushed immediately, then every push interval ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)) |
| Off-site backup copy (`OFFSITE_BACKUP_COMMAND`) | The copy after a backup fails and is recorded as failed; the local dump is kept | The next scheduled backup is copied again ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)) |
| Public URL (`APP_URL`), Telegram Mini App, links opened outside the venue | Unavailable (they are not served by the edge server) | Available |
| ACME certificates (only if configured) | Renewal waits | Renews automatically |

## How the edge server detects the Internet

The worker's WAN monitor ([packages/core/src/runners/wan-monitor.ts](../packages/core/src/runners/wan-monitor.ts)):

- Sends `HEAD` requests to every URL in `WAN_PROBE_URLS` (default `https://api.telegram.org`,
  `https://1.1.1.1`) every `WAN_PROBE_INTERVAL_MS` (default 15 s), timeout 4 s, redirects not followed.
- **Any HTTP response from any URL** counts as "Internet available"; no response from all of them
  counts as unavailable. HTTPS probes are not fooled by captive portals.
- Persists the result on the edge node (`ONLINE` or `DEGRADED`, `last_wan_seen_at`) and broadcasts
  `edge.status.updated` to every connected device when the state changes. The persisted state also
  catches outages that started or ended while the worker was stopped.
- When a transport reports a network error during delivery, the monitor probes immediately instead
  of waiting for the next interval.

## How staff see it

| Where | What |
| --- | --- |
| Connectivity badge (staff and player surfaces) | `LOCAL` (server connected), `LOCAL · OFFLINE` (Internet unavailable), `LOCAL · SYNCING` (cloud sync enabled with pending events), `Reconnecting…` (edge server unreachable), `OFFLINE` (the device has no network) |
| Banner on staff surfaces | *Local server connected · Internet unavailable · Telegram notifications paused · Tournament operations fully available*; a red banner *Local server unreachable · Reconnecting…* when the device lost the server |
| **Admin → Local network → Edge status** | Internet online/offline, last Internet contact, Telegram state, cloud sync pending, server time and this device's clock offset |
| **Admin → Health & backups** | Component `wan` = `DEGRADED` with "Internet unavailable — local operations unaffected"; overall `DEGRADED`, never `DOWN` |
| TV displays and kiosk | A pulsing red dot next to the time when the local server is unreachable (not for WAN loss) |
| `GET /health` | `DEGRADED` with HTTP 200 while offline; 503 only when PostgreSQL is down |
| `GET /api/v1/edge/status` (public) | The same payload that devices receive |

Every WebSocket connection starts with a `welcome` message carrying the current edge status and the
server time; changes arrive as `edge.status.updated` events (topic `*`, public audience) with:

```json
{
  "nodeId": "edge-poker",
  "status": "DEGRADED",
  "wanOnline": false,
  "lastWanSeenAt": "2026-09-29T19:41:02.114Z",
  "telegram": "WAITING_FOR_NETWORK",
  "cloudSync": { "enabled": false, "pending": 0, "lastSyncAt": null },
  "serverTime": "2026-09-29T19:44:10.020Z"
}
```

Tell floor staff: *"If the badge says LOCAL · OFFLINE, carry on. Only Telegram and cloud features
wait. If it says Reconnecting…, the tablet cannot reach the server: check Wi-Fi first."*

## Notifications: never deliver stale real-time messages

A message like "your table breaks now" is harmful 40 minutes later. Every notification gets an expiry
time when it is created ([packages/domain/src/notifications.ts](../packages/domain/src/notifications.ts)):

| Type | TTL |
| --- | --- |
| `TABLE_MOVE` | 5 minutes |
| `LATE_REGISTRATION_CLOSING` | 10 minutes |
| `ANNOUNCEMENT` | 15 minutes |
| `SEAT_ASSIGNED` | 20 minutes |
| `STAFF_ALERT` | 1 hour |
| `REGISTRATION_OPENING` | 6 hours, and never after the event time |
| `TOURNAMENT_REMINDER` | 12 hours, and never after the tournament start |
| `TOURNAMENT_CHANGED` | 12 hours |
| `REGISTRATION_CONFIRMED`, `REGISTRATION_CANCELLED`, `TOURNAMENT_CANCELLED` | 1 day |
| `LEAGUE_POSITION_CHANGED` | 3 days |
| `RESULTS_FINALIZED` | 7 days |

Rules enforced by the dispatcher ([packages/core/src/notifications/dispatcher.ts](../packages/core/src/notifications/dispatcher.ts)):

1. Each cycle (every `DISPATCH_INTERVAL_MS`, default 2 s) first marks every `PENDING` notification past
   its expiry as `EXPIRED` — also while offline.
2. While the WAN is down nothing is claimed or attempted; messages stay `PENDING` with their attempt
   count untouched.
3. Expiry is checked again right before each send.
4. A retry that would happen after the expiry turns the message `EXPIRED` instead.
5. In-app inbox messages are stored as delivered at once; they never wait for the Internet.

## Retry rules

Due messages are claimed in a short transaction (`FOR UPDATE SKIP LOCKED`, up to 50 per cycle, oldest
first, status `SENDING`) and delivered outside it. Delivery is paced to Telegram's limits: at least
1.05 s between messages to the same chat and 40 ms between messages otherwise.

| Outcome | Examples | Next state |
| --- | --- | --- |
| Sent | – | `SENT` |
| Network down | Telegram network error or timeout; SMTP connection refused/timeout/DNS failure | Stays `PENDING`, **attempt not counted**, next try in 30 s (brought forward as soon as the Internet returns); the rest of the claimed batch is released untouched and the WAN monitor probes immediately |
| Retryable | Telegram 429 (rate limit), 409, 5xx; other transient errors | Attempt counted; delay = Telegram `retry_after` + 250 ms, otherwise exponential back-off from 2 s doubling per attempt, capped at 10 minutes, with jitter |
| Permanent | Telegram 400/401/403 (chat not found, bot blocked, bad token), Telegram not configured for the club, SMTP 5xx, channel without transport | `FAILED` |
| Too many attempts | 8 counted attempts | `FAILED` |
| Past expiry | – | `EXPIRED` |

Every Telegram attempt is also recorded in `telegram_deliveries`. Notifications carry dedupe keys, so
the same reminder or confirmation is created only once. The queue is visible on **Admin → Telegram**.

## When the Internet returns

As soon as a probe succeeds:

1. The edge node status becomes `ONLINE`; `edge.status.updated` is broadcast and the offline banners
   disappear on every device.
2. Telegram long polling is woken up immediately instead of finishing its back-off; the bot answers
   again.
3. Retries that were postponed by a network error become due now, and the dispatcher runs at once:
   every still-valid queued message is delivered **exactly once**, in creation order and paced;
   expired ones stay `EXPIRED`.
4. Cloud sync pushes immediately (if enabled) and continues every push interval until the backlog is
   empty.
5. A staff alert **"Internet restored"** (severity INFO, "Edge server WAN connectivity restored. Queued
   notifications are being delivered.") is queued to the staff alerts chat, if one is configured in
   **Admin → Telegram**.

## Edge server power loss

A power cut or hard crash of the edge server is survivable without manual steps:

| Concern | What happens |
| --- | --- |
| Data | Every command is one PostgreSQL transaction; committed data is durable (write-ahead log; the compose file keeps PostgreSQL's default durability settings). Uncommitted work is rolled back, so no command is half-applied. Outbox events are written in the same transaction, so no committed change loses its event |
| Restart | With "power on after AC loss" in the BIOS, the server boots, Docker starts (enabled by the install script) and all containers restart (`restart: unless-stopped`). API and worker wait for PostgreSQL to be healthy |
| Tournament clock | Stored as an anchor (level, `startedAt` or paused remainder), not as a ticking counter. After the restart the ticker materializes the levels that ended while the server was off; the next level starts at the moment the previous one ended, not when power returned. This relies on a correct system clock (NTP, RTC battery) |
| Staff sessions | Stored in PostgreSQL: tablets stay signed in (until `SESSION_TTL_HOURS`) |
| Commands in flight | Every command carries a `clientOperationId`. Retrying after a lost response applies it exactly once and returns the original result (`duplicate: true`); the same key with a different payload is rejected (`IDEMPOTENCY_MISMATCH`) ([API.md](API.md)) |
| Events committed while the worker was down | The notification fan-out continues from its cursor; messages go out once when the worker is back |
| Messages claimed at the moment of the crash | When the worker starts, rows still in `SENDING` whose claim is older than 2 minutes return to `PENDING` (and then follow the expiry rules) |
| Devices | Browsers reconnect automatically (back-off from 0.5 s up to 8 s, immediately when the network or the tab comes back), re-subscribe and reload snapshots. TVs and the kiosk keep showing the last state and keep counting the clock down locally while disconnected |
| Redis | Restarts empty; it only holds rate-limit counters |

If a backup was running at the moment of the crash, see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md#troubleshooting).

## Local network problems (not the Internet)

If the router, switch, access point or the edge server itself is down, devices cannot reach the
server: badges show `Reconnecting…` or `OFFLINE`, displays show the red dot. The service worker only
caches the application shell and serves a "local server is unreachable" page for navigations; it never
serves stale tournament data. Put the network equipment on the UPS as well
([EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md#power-and-ups)).

## Evidence

The end-to-end suite runs the real API and worker processes against PostgreSQL with switchable
stand-ins for the Internet ([DEPLOYMENT.md](DEPLOYMENT.md#tests)):

| Test | Shows |
| --- | --- |
| [tests/e2e/lan.test.ts](../tests/e2e/lan.test.ts) | The whole tournament runs from the edge server with no external request; concurrent edits, idempotent retries, undo; realtime delivery p95 below 1 s to staff, public and display sockets |
| [tests/e2e/wan-recovery.test.ts](../tests/e2e/wan-recovery.test.ts) | WAN loss is detected and pushed to devices (`wanOnline: false`, status `DEGRADED`); registration, check-in, moves, clock and eliminations each answer in under 1.5 s while offline; Telegram messages stay `PENDING` with 0 attempts; after the WAN returns, still-valid messages are sent exactly once, a table move past its TTL is `EXPIRED` and never sent, staff get "Internet restored", every event reaches the cloud, the bot answers again |
| [tests/e2e/restart.test.ts](../tests/e2e/restart.test.ts) | `SIGKILL` of API and worker mid-tournament: seats, chips and statuses are identical after restart, the clock advanced to the next level at the time the old level ended, sessions stay valid, a command retried after the crash applies once, events committed while the worker was down are delivered once, a notification stuck in `SENDING` is recovered, devices reconnect and receive events |
| [tests/e2e/telegram.test.ts](../tests/e2e/telegram.test.ts) | The bot ignores redelivered updates and repeated button presses (no double registration) |
| [packages/domain/test/notifications-sync.test.ts](../packages/domain/test/notifications-sync.test.ts) | TTLs, retry back-off, no attempt consumed while the network is down, expiry instead of late retries, attempt cap |

The restart test kills the application processes; PostgreSQL itself keeps running in that test, so the
durability of committed data on a real power cut rests on PostgreSQL's write-ahead log.
