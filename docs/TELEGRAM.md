# Telegram integration

The club's Telegram bot lets players browse tournaments, register and cancel, see their seat and
results, and receive notifications; staff can receive alerts and read the edge status. Telegram is an
**external integration**: it needs the Internet, and nothing in a live tournament waits for it. When
the Internet is down the bot is silent and notifications queue up; valid ones are delivered when it
returns (see [OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)).

Code: `packages/telegram` (Bot API client, long poller, verification helpers),
`packages/core/src/telegram/` (bot conversation, account linking, token resolution),
`packages/core/src/runners/telegram-poller.ts`, `packages/core/src/notifications/`.

## 1. Setting up the bot

1. In Telegram, talk to **@BotFather**: `/newbot`, choose a name and a username ending in `bot`.
   Copy the token (`123456789:AA…`).
2. In the web app open **Admin → Telegram**, switch the integration on, keep the mode
   **Long polling from the edge server**, paste the token and save. The token is verified with
   Telegram when the Internet is available; saving works offline too (status "waiting for network").
   Alternatively set `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in the
   edge server's `.env` (the environment token serves the club that owns the edge node; a token saved
   in the admin page takes precedence).
3. Optional: enter a **staff alerts chat id** (a group with the bot, or a staff member's chat) and use
   **Send test message**.
4. Optional feature flags in **Admin → Settings**: *Telegram Mini App* (adds a Mini App button to the
   bot menu, requires a public `https://` `APP_URL`) and *Telegram staff commands* (see §6).

Saving the integration also switches the club's `telegram` feature flag, which gates Telegram
notifications. The token is stored encrypted (AES-GCM, key from `SECRETS_ENCRYPTION_KEY` or derived
from `SESSION_SECRET`), is never returned by the API (only `tokenConfigured: true`) and never logged.

## 2. Modes

| Mode | How updates arrive | Network needs |
| --- | --- | --- |
| `EDGE_LONG_POLLING` (default) | The worker calls `getUpdates` in a loop | Outbound HTTPS only — no public address, no port forwarding |
| `CLOUD_WEBHOOK` | A cloud gateway forwards Telegram webhooks to `POST /api/v1/telegram/webhook/{organizationId}` | The gateway must reach the edge; requests must carry `X-Telegram-Bot-Api-Secret-Token` equal to `TELEGRAM_WEBHOOK_SECRET` (constant-time compare) |

Long polling details (`runners/telegram-poller.ts`, `packages/telegram/src/poller.ts`):

- One poller per bot token across all worker instances (PostgreSQL advisory lock keyed by the bot id).
- The webhook is deleted before polling (Telegram refuses `getUpdates` while a webhook is set).
- The last processed `update_id` is stored per club; the offset never moves backwards, so a
  re-delivered old update cannot replay newer ones.
- Errors back off exponentially (up to 60 s) and honour Telegram's `retry_after`. When the WAN
  monitor sees the Internet return, network back-offs end immediately.
- Status (`ONLINE`, `WAITING_FOR_NETWORK`, `ERROR`, `DISABLED`) is shown in Admin → Telegram and in the
  edge status broadcast to staff devices.

## 3. Linking accounts

Telegram users are identified by their numeric Telegram user id — never by username, which is stored
only for display. A Telegram account links to one player profile or one staff account per club.

| Flow | Steps | Validity |
| --- | --- | --- |
| Deep link (recommended) | Player page **Me → Telegram → Connect** (or staff equivalent) creates `https://t.me/<bot>?start=link_<token>`; opening it sends `/start link_<token>` to the bot, which binds the account | Single use, 15 minutes; only a hash is stored |
| Code from the bot | Send `/link` to the bot → 8-character code; enter it on the web under **Me → Telegram** | Single use, 10 minutes; rate-limited (10 attempts / 15 min) |

Linking revokes any previous active link of the same Telegram user or the same account. Players can
unlink in their profile. Linking is audited (`TELEGRAM_LINKED` / `TELEGRAM_UNLINKED`).

## 4. What the bot offers

`/start` (or any unknown text) shows the menu. Commands: `/events`, `/my`, `/live`, `/seat`,
`/standings`, `/link`, `/status` (staff), `/help`.

| Button / command | Linked account needed | What it does |
| --- | --- | --- |
| Upcoming tournaments (`/events`) | no | Published public tournaments that are scheduled, open or running |
| Tournament details | no | Date, venue, format, stack, buy-in, registrations, your status; Register / Cancel / Follow buttons; web and live links when `APP_URL` is set |
| Register | player | `REGISTER_PLAYER` with source `TELEGRAM`, allowed while registration or late registration is open (including the seat draw) and online registration is enabled |
| Cancel registration | player | `CANCEL_REGISTRATION` for your own registration |
| Follow / Unfollow a tournament | no | Announcements for that tournament are sent to this chat |
| Alert me about new tournaments | no | Registration-opening alerts and club-wide announcements |
| My registrations (`/my`) | player | Upcoming registrations with status and waitlist position |
| Current tournament (`/live`) | no | Level, blinds, clock, players left, average stack; your seat if linked |
| My seat (`/seat`) | player | Table and seat in running tournaments |
| League standings (`/standings`) | no | Top of the latest leaderboard |
| My results | player | Latest finalized results with points |
| Notifications | player | Switch notification types on/off for Telegram |
| Mini App | player | Opens `/tg/{club}` inside Telegram when the Mini App flag is on |

`/start t_<slug>` (from a tournament QR code) opens that tournament's details directly.

## 5. Reliability: duplicates and retries

- **Update receipts.** Each `update_id` is recorded per club before it is handled; a redelivered
  update (after a crash or a lost acknowledgement) is ignored — no second reply, no second action.
- **Deterministic operation ids.** Registration and cancellation derive the tournament command's
  `clientOperationId` from the club and the `update_id`, so even a race cannot register a player twice.
  Pressing Register again later answers "already registered".
- **No waiting on Telegram.** Handlers change the database through the same command executor as the
  floor; replies are sent afterwards. A failed reply never undoes the registration.
- These properties are exercised by `tests/e2e/telegram.test.ts` (forced redelivery, repeated button
  presses, WAN outage and recovery).

## 6. Staff over Telegram

- Staff link their own account the same way (deep link from the staff profile, or `/link`).
- `/status` (requires `edge.read`): edge/WAN state, component health and a line per active tournament.
- State-changing commands are **off by default** (spec §29). With the *Telegram staff commands* flag
  on, `/pause [slug]` and `/resume [slug]` are available to staff with `tournament.clock.control`; each
  asks for confirmation with a button valid for 60 seconds and bound to the same Telegram user.
  `/finish`, `/reset`, `/cancel` and `/refund` are always refused ("performed in the floor application").
- The staff alerts chat receives alerts such as "Internet restored" and "Backup failed".

## 7. Notifications

Domain code never calls Telegram. Events in the outbox are turned into notifications by the worker's
fan-out; a dispatcher delivers them (`notifications/fanout.ts`, `dispatcher.ts`, `templates.ts`).

| Type | Sent to | Time to live |
| --- | --- | --- |
| `REGISTRATION_CONFIRMED` (incl. promotion from the waitlist) | player | 1 day |
| `REGISTRATION_CANCELLED` | player | 1 day |
| `TOURNAMENT_REMINDER` (about 2 h before the start) | registered players | 12 h, never after the start |
| `TOURNAMENT_CHANGED` (start time moved) | registered players | 12 h |
| `TOURNAMENT_CANCELLED` | registered players | 1 day |
| `REGISTRATION_OPENING` | schedule followers | 6 h, never after the start |
| `LATE_REGISTRATION_CLOSING` (about 10 min before a level-based close) | tournament and schedule followers | 10 min |
| `SEAT_ASSIGNED` | player | 20 min |
| `TABLE_MOVE` (balance, table break, manual move) | player | 5 min |
| `RESULTS_FINALIZED` | every ranked player | 7 days |
| `LEAGUE_POSITION_CHANGED` (moved up, top 50) | player | 3 days |
| `ANNOUNCEMENT` (when Telegram is a chosen channel) | followers, registered players | 15 min |
| `STAFF_ALERT` | staff alerts chat | 1 h |

Rules:

- Channels per player follow the club's notification-type switches (Admin → Settings) and the
  player's own preferences; banned players receive nothing. Messages use the player's language
  (English or Russian), falling back to the club locale.
- **Never late.** A notification past its time to live is marked `EXPIRED` and never sent — e.g. a
  table move queued during a long outage is dropped, not delivered hours later.
- **While the WAN is down** nothing is attempted; rows stay `PENDING` and no attempts are used. A
  delivery that hits a network error is postponed without using an attempt and brought forward as soon
  as the Internet returns.
- **Retries** for other errors: exponential back-off with jitter (from 2 s, capped at 10 min), honouring
  `retry_after`; at most 8 attempts; permanent errors (e.g. the user blocked the bot) fail at once.
- **Pacing**: about one message per second per chat.
- Rows are claimed (`SENDING`) in a short transaction and sent outside it; rows left in `SENDING` by a
  crash (claimed more than two minutes earlier) return to the queue when the worker starts again. Such
  a message may, rarely, be delivered twice if the crash happened right after Telegram accepted it.
- Every Telegram attempt is recorded in `telegram_deliveries` (message id, status, HTTP status, error);
  Admin → Telegram shows the queue, counters and per-notification attempts.

## 8. Mini App

`/tg/{club}` is a page for Telegram's in-app browser. It sends Telegram's `initData` to
`POST /api/v1/auth/telegram-miniapp`, where the signature is verified with the bot token and must be
less than one hour old. Only Telegram users linked to a player profile are signed in (a password-less
web account is created for desk-created players on first use). The page may be framed by Telegram Web
(`frame-ancestors` allows `web.telegram.org`/`*.telegram.org`, no `X-Frame-Options` on `/tg/*`); every
other page refuses framing.

## 9. Troubleshooting

| Symptom | Check |
| --- | --- |
| Status `WAITING_FOR_NETWORK` | The edge server has no Internet. Local operations are unaffected; the bot resumes on its own |
| Status `ERROR` with "Unauthorized" | Token revoked or mistyped — create a new token in @BotFather and save it again |
| Status `DISABLED` | Integration switched off, or no token for this club |
| Bot answers "Link your player account first" | The Telegram user is not linked: use the deep link from the player profile or `/link` |
| Deep link says "expired or already used" | Links are single-use and valid for 15 minutes; create a new one |
| No notifications although linked | Club `telegram` flag, notification type switched off by the club or by the player (bot → Notifications), notification expired (see queue) |
| Webhook mode returns 403 | `TELEGRAM_WEBHOOK_SECRET` missing or not matching the gateway's secret header |
| Two edge servers use the same bot | Only one polls (advisory lock); the other waits. Use one bot per club |
