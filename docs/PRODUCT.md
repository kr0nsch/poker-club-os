# Poker Club OS — Product Overview

Poker Club OS runs the **live tournament operation of a poker club** from a single
**Venue Edge Server** inside the venue. Every staff tablet, TV screen, kiosk and player
phone talks to that server over the venue network; the Internet is only needed for
optional extras (Telegram, cloud sync, e-mail, off-site backups). If the WAN drops in the
middle of a tournament, registration, seating, the clock, eliminations and results keep
working.

Related documents: [ARCHITECTURE.md](ARCHITECTURE.md) · [DOMAIN_MODEL.md](DOMAIN_MODEL.md) ·
[TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md) · [SEATING_ENGINE.md](SEATING_ENGINE.md) ·
[REALTIME.md](REALTIME.md) · [OFFLINE_OPERATION.md](OFFLINE_OPERATION.md) ·
[TELEGRAM.md](TELEGRAM.md) · [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) ·
[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) · [DEVICE_SETUP.md](DEVICE_SETUP.md)

---

## 1. Who uses it

| Person | Main surface | Typical role (see [SECURITY.md](SECURITY.md#5-rbac)) | What they do |
|---|---|---|---|
| Club owner / manager | `/admin` | `ORGANIZATION_OWNER`, `MANAGER` | Settings, feature flags, staff, venues, Telegram, backups, analytics, audit log |
| Tournament director (TD) | `/admin`, `/floor` | `TOURNAMENT_DIRECTOR` | Structures, templates, tournaments, publish, run the event, finalize results |
| Floor manager | `/floor` | `FLOOR_MANAGER` | Clock, seating, moves, balancing, table breaks, eliminations, re-entries |
| Registration desk | `/floor` (registration desk) | `REGISTRATION_STAFF` | Find/create players, register, check in, initial entries |
| Cashier | `/floor` | `CASHIER` | Check-in with buy-in, rebuys, add-ons, re-entries, voids |
| Dealer | `/dealer` | `DEALER` | Mark seats present, report busts, call the floor, confirm player moves |
| Marketing | `/admin` | `MARKETING_MANAGER` | Players, exports, leagues, announcements (incl. Telegram), analytics |
| Analyst | `/admin` | `READ_ONLY_ANALYST` | Read-only tournaments, players, results, analytics |
| Player | `/p/<org>`, Telegram bot, Mini App `/tg/<org>` | player account (no staff role) | Schedule, register/cancel, live clock, own seat, results, league standings, notifications |
| TV screen | `/display/<token>` | display token (no sign-in) | Clock, blinds, stats, announcements, seating during the draw, leaderboard |
| Kiosk tablet | `/kiosk/<token>` | kiosk token (no sign-in) | Player self check-in |

After sign-in the start page routes people automatically (`apps/web/src/lib/home.ts`): users
whose roles are all `DEALER` go to `/dealer`, users whose roles are all floor roles
(`FLOOR_MANAGER`, `REGISTRATION_STAFF`, `CASHIER`, `DEALER`) go to `/floor`, other staff to
`/admin`, players to `/p/<org>`. Before first-run setup every visitor is sent to `/setup`.

## 2. Surfaces and URLs

All surfaces are served by the same web application behind the edge reverse proxy
(see [LOCAL_NETWORK.md](LOCAL_NETWORK.md)).

| URL | Surface | Access |
|---|---|---|
| `/setup` | First-run wizard: organization, venue, edge node name, owner account | one-time setup token ([SECURITY.md](SECURITY.md#8-first-run-setup-token)) |
| `/login` | Staff sign-in | e-mail + password |
| `/admin` | Back office dashboard | staff |
| `/admin/tournaments`, `/admin/tournaments/new`, `/admin/tournaments/<id>` | Tournament planning, configuration, QR codes, lifecycle | `tournament.read` (+ write permissions) |
| `/admin/structures`, `/admin/structures/<id>`, `/admin/structures/templates/<id>` | Blind structures, tournament templates, house-rules profiles | `tournament.read` / `structure.manage` |
| `/admin/players`, `/admin/players/<id>`, `/admin/players/import` | Player CRM, notes, tags, consents, kiosk PIN, anonymization, CSV import | `player.read` (+ write permissions) |
| `/admin/leagues`, `/admin/leagues/seasons/<id>` | Score rules, leagues, seasons, series, leaderboards | `tournament.read` / `league.manage` |
| `/admin/displays` | TV display and kiosk links, display templates | `display.manage` |
| `/admin/network` | Local URLs and QR codes for staff, players, back office | `edge.read` |
| `/admin/devices` | Device registry, trust label, table assignment, revoke, disconnect | `device.manage` |
| `/admin/health` | Component health, backups, cloud-sync status and conflicts | `edge.read` |
| `/admin/telegram` | Bot token, mode, staff alerts chat, notification queue | `telegram.manage` |
| `/admin/staff` | Staff accounts, roles, venue restrictions | `staff.manage` |
| `/admin/analytics` | Operational and business analytics | `analytics.read` |
| `/admin/audit` | Append-only audit log | `audit.read` |
| `/admin/settings` | Organization settings, feature flags, notification types, venues | `settings.manage` (view for others) |
| `/floor`, `/floor/<id>` | Floor control: registration desk, entries, tables, clock, results, announcements, action log with undo, floor requests | staff |
| `/dealer`, `/dealer/<tournamentId>/<tableId>` | Dealer tablet for one table | staff (`dealer.table.operate`) |
| `/p/<org>` | Player home: published schedule | public |
| `/p/<org>/t/<slug>` | Tournament page with registration | public; registering needs a player account |
| `/p/<org>/live`, `/p/<org>/live/<slug>` | Live clock, stats, announcements, seating list, own seat | public (own seat when signed in) |
| `/p/<org>/leaderboard` | League standings | public |
| `/p/<org>/me` | Profile, notifications inbox and preferences, Telegram linking, kiosk one-time code, history | player |
| `/p/<org>/login`, `/p/<org>/signup` | Player sign-in and self sign-up | public |
| `/p/t/<slug>` | Organization-less tournament link, forwards to the club page after sign-in | public |
| `/display/<token>` | TV display | display token in the URL |
| `/kiosk/<token>` | Self check-in kiosk | kiosk token in the URL |
| `/tg/<org>` | Telegram Mini App entry | Telegram-signed `initData` + linked account ([TELEGRAM.md](TELEGRAM.md#9-mini-app)) |

The HTTP API behind these pages is documented in [API.md](API.md); the WebSocket
protocol in [REALTIME.md](REALTIME.md).

## 3. Main workflow

The tournament lifecycle is `DRAFT → SCHEDULED → REGISTRATION_OPEN → (SEATING) → RUNNING ⇄
BREAK / PAUSED / HAND_FOR_HAND → FINISHED → FINALIZED`, with `CANCELLED` reachable from any
non-final state. Details: [TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md).
Every live change is a command sent to `POST /api/v1/tournaments/<id>/commands` with an
idempotency key and the expected tournament version ([SECURITY.md](SECURITY.md#11-integrity-controls-idempotency-and-concurrency)).

### 3.1 Plan

1. **Structure** — blind levels (play/break, small/big blind, ante type `NONE`/`STANDARD`/`BIG_BLIND`,
   duration 30 s–6 h). Setup creates a default "Standard 20-minute levels" structure.
2. **House rules profile** — seating and balancing rules (random initial seating, late-registration
   seat policy, table break order, balance selection, max imbalance, seat locking, final table size).
   Setup creates a "TDA 2026 style" default profile.
3. **Template** (optional) — structure, buy-in and entry options saved for re-use; tournaments can be
   created from a template with only venue, date and league/series.
4. **Tournament** — venue, start time, game type (`NLHE`, `PLO`, `PLO5`, `MIXED`, `OTHER`), format,
   starting stack, table size (2–11), max players (waitlist when full), buy-in (amount + fee +
   currency, recorded only), late registration / re-entry / rebuy / add-on / bounty policies,
   visibility (`PUBLIC`, `UNLISTED`, `PRIVATE`), optional season/series. The tournament gets its own
   copy of the structure.

Formats with full floor support in this release: `FREEZEOUT`, `REENTRY`, `REBUY`, `BOUNTY`.
`PROGRESSIVE_KO`, `MYSTERY_BOUNTY`, `SATELLITE`, `SHOOTOUT`, `MULTI_DAY` can be selected but are
marked "limited support" in the UI.

### 3.2 Publish and open registration

- `PUBLISH` validates the structure and moves the tournament to `SCHEDULED`; published
  `PUBLIC` tournaments appear on `/p/<org>` and in the Telegram bot. `UNLISTED` ones are reachable by
  direct link only; `PRIVATE` ones never appear on player pages.
- `OPEN_REGISTRATION` → `REGISTRATION_OPEN`.
- `/admin/tournaments/<id>` offers QR codes for the local registration page, the local live page, the
  public registration page (if `APP_URL` is set) and a Telegram deep link (`t_<slug>`).

### 3.3 Registration channels

| Channel | How | Source recorded |
|---|---|---|
| Player web / QR | `/p/<org>/t/<slug>` → Register (player account required) | `PLAYER_WEB`, `PLAYER_QR` |
| Telegram bot | Inline "Register" button (linked account required) | `TELEGRAM` |
| Telegram Mini App | Player pages opened inside Telegram | `TELEGRAM_MINI_APP` |
| Desk | Registration desk on `/floor` (search or create the player) | `STAFF`, `WALK_IN` |

Self-service registration requires the `playerRegistration` flag, a published non-`PRIVATE`
tournament, and either `REGISTRATION_OPEN` or a running tournament with late registration still
open. Full tournaments put players on a waitlist; cancellations promote the oldest waitlisted
player. Each registration gets a 10-character check-in code shown as a QR code to the player.

The **kiosk does not register players**: it only checks in existing registrations.

### 3.4 Check-in and buy-in

- **Desk / cashier**: `CHECK_IN` (optionally creating the initial entry and seating the player) or
  `CREATE_ENTRY` later. Undo check-in and no-show marking are available.
- **Kiosk** (`/kiosk/<token>`): the player identifies with the registration QR code, member number +
  kiosk PIN (4–8 digits, set by staff), or a 6-digit one-time code from `/p/<org>/me` (valid 15 min,
  single use). The kiosk creates the entry and seat only for free tournaments or when the
  `paidRegistration` flag says registration was prepaid; otherwise it tells the player to go to the
  cashier. **The kiosk never takes money.**

### 3.5 Seat draw

`START_SEATING` (with draw) or `START_TOURNAMENT` seats every active entry without a seat, opening
tables as needed. The draw uses a cryptographic RNG. Tables can be added, closed, seats locked and
the dealer button set. Details: [SEATING_ENGINE.md](SEATING_ENGINE.md).

### 3.6 Run the clock

The clock is derived from a persisted anchor; the worker materialises automatic level changes about
every 0.5 s and every device renders the countdown locally. Floor commands: pause/resume, next/previous
level, set level, adjust ±time, set remaining time, hand-for-hand start/end, close/reopen late
registration. Level and time commands can carry the level the operator was looking at
(`fromLevelIndex`), so a level that advanced automatically meanwhile is not skipped.

### 3.7 Eliminations, rebuys, re-entries, add-ons

- `ELIMINATE_PLAYERS` handles one or several busts in the same hand (ordered by starting stack),
  optional eliminator (bounty transaction when bounties apply). Finishing positions are assigned
  once late registration is closed.
- `RESTORE_PLAYER` and `UNDO_ACTION` correct mistakes (with a reason, audited).
- `REBUY`, `ADD_ON`, re-entries (new entry after elimination, permission `entry.reentry`),
  `CHIP_ADJUSTMENT`, `VOID_TRANSACTION`, `VOID_ENTRY` follow the tournament's policies.
- Dealers report busts from `/dealer`; a report is a floor request, the floor confirms the elimination.

### 3.8 Balancing and breaking tables

The floor previews a balance plan or a table-break plan (`/balance/preview`, `/break/preview`) and
applies it with `APPLY_BALANCE` / `BREAK_TABLE`. Both are strict-version commands: if the room
changed since the preview, the command is rejected and the floor re-previews. Moved players get a
`TABLE_MOVE` notification; dealers confirm arrivals.

### 3.9 Finish, finalize, league points

1. `FINISH_TOURNAMENT` computes provisional standings (a final order can be supplied for a deal).
   `REOPEN_TOURNAMENT` returns to `PAUSED` with a reason.
2. `FINALIZE_RESULTS` marks results final and applies league points when the tournament belongs to a
   season: score rules are a position table or a safe formula (default
   `max(0, 10 * sqrt(entrants) / sqrt(position) - 1) + 1`), optionally counting only the best N results.
   A new leaderboard snapshot is stored; players who climb get `LEAGUE_POSITION_CHANGED`.
3. `CORRECT_RESULT` swaps positions with a reason and recalculates points when already finalized.
4. Results export: `GET /api/v1/tournaments/<id>/results.csv`.

## 4. Other features

- **Announcements** to TV displays and player live pages, optionally Telegram.
- **Notifications** in-app, Telegram and (if SMTP is configured) e-mail; per-type TTL so stale
  messages are dropped. See [TELEGRAM.md](TELEGRAM.md#10-notifications).
- **Player CRM**: search, tags, staff notes (`STAFF` / `MANAGEMENT` visibility), consent history,
  CSV import with column mapping and duplicate handling, `players.csv` export, anonymization.
- **Analytics**: dashboard (today, new vs returning, 90-day rates, 30-day retention) and analytics
  (check-in timing, conversion, channels, re-entry rate, table breaks, cohorts, Telegram effect).
- **Operations**: device registry, health page, scheduled `pg_dump` backups with optional off-site
  command ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)), optional cloud sync
  ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)).
- **PWA**: the service worker caches only the application shell; API data is never cached.

## 5. Feature flags

Stored per organization, edited on `/admin/settings` (`settings.manage`); defaults from
`DEFAULT_FEATURE_FLAGS` in `packages/types/src/enums.ts`.

| Flag | Default | Effect in the current code |
|---|---|---|
| `playerRegistration` | on | Enforced: player self sign-up, web/Telegram self-registration |
| `qrRegistration` | on | Label only — not checked by server or UI |
| `telegram` | off | Enforced for notification delivery and Telegram announcements; switched together with the integration on `/admin/telegram` |
| `telegramMiniApp` | off | Shows the Mini App button in the bot menu (sign-in endpoint itself does not check it) |
| `telegramStaffCommands` | off | Enforced: allows `/pause` and `/resume` with confirmation |
| `kiosk` | on | Label only |
| `dealerInterface` | on | Label only |
| `leagues` | on | Label only |
| `publicProfiles` | off | Label only |
| `publicSeatList` | on | Enforced: seat list on player live pages and public seat events |
| `paidRegistration` | off | Enforced: kiosk check-in creates the buy-in entry |
| `prizeTracking` | off | Enforced: prize pool statistic shown publicly |
| `memberships`, `cashGameWaitlists`, `timeCharge` | off | Not implemented |
| `advancedAnalytics` | on | Label only |
| `cloudSync` | off | Label only — cloud sync is controlled by `CLOUD_SYNC_ENABLED` |
| `remoteAccess` | off | Not implemented (see [NETWORK_SECURITY.md](NETWORK_SECURITY.md#7-remote-access)) |

`telegramStaffCommands` and `remoteAccess` are marked "security-sensitive" in the UI and need a
confirmation to turn on.

## 6. Languages

- The web UI is available in **English** and **Russian**; the choice is stored per browser
  (`localStorage`), defaulting to the browser language.
- The organization default locale (`en`/`ru`) and each player's notification language select the
  language of notification messages (`packages/core/src/notifications/templates.ts`).
- The Telegram bot conversation (menus, replies) is English only.

## 7. Intentionally out of scope

- **No real-money handling.** No payment provider, no card processing, no online wallet. Buy-in,
  rebuy and add-on amounts are recorded as numbers for bookkeeping; the cashier handles money
  physically. The kiosk never takes money. "Prepaid registration" only tells the kiosk that
  payment happened elsewhere.
- **No online poker.** Cards are dealt at physical tables; the system does not deal, track hands or
  chip counts beyond recorded transactions.
- **No payouts engine.** `tournament_results.prize_amount` exists but no command writes it.
- **Not implemented:** cash-game waitlists, time charge, memberships, built-in remote access, SMS and
  push transports (adapters return "not configured"), S3 object storage adapter (`S3_*` settings are
  unused), Sentry (`SENTRY_DSN` is unused), custom-role editing via API (custom roles are read from the
  `roles` table only).
- **Cloud control plane and Telegram webhook gateway** are external services the edge can talk to;
  they are not part of this repository ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)).

Assumptions behind these choices: [ASSUMPTIONS.md](ASSUMPTIONS.md).
