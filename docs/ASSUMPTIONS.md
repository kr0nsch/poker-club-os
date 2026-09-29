# Assumptions, decisions and known limitations

This document records where the implementation deliberately differs from the master specification,
which open questions were decided and how, and what is known to be missing. It is the first place to
look before assuming a behaviour.

## Technology decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Runtime | Node.js 24, pnpm 12 workspaces, Turborepo | Current LTS toolchain; one language across API, worker and web |
| API | NestJS 12.1 on Fastify 5 (ESM), explicit `@Inject` tokens | ESM without `emitDecoratorMetadata`; Fastify for throughput and native WebSocket upgrade handling |
| Web | Next.js 16.3 App Router, React 19.3, Tailwind v4, TanStack Query 5 | `proxy.ts` replaces the removed `middleware.ts`; standalone output for the Docker image |
| Database | PostgreSQL 18, Drizzle ORM 0.45 (snake_case), SQL migrations in `packages/db/drizzle` | PostgreSQL is the single source of truth on the edge server |
| Validation | Zod 4 schemas shared by API, worker and web | One definition of every command and payload |
| TypeScript | 6.0.3, not 7.x | typescript-eslint does not support TypeScript 7 yet |
| Background jobs | PostgreSQL-backed loops in the worker (outbox + cursors, `FOR UPDATE SKIP LOCKED` claims, advisory-lock singletons) instead of BullMQ | One durable store is simpler to back up and survives power loss; Redis becomes optional |
| Redis | Optional; used only for rate limiting, with an in-process fallback | A single edge node per venue does not need a shared cache; the system runs without Redis |
| Realtime | Own WebSocket hub fed by PostgreSQL `LISTEN/NOTIFY` after commit | Only committed changes are broadcast; no extra broker |
| Money | Integer minor units (cents/kopecks) with an ISO currency code | No floating point in amounts |
| Clock | Server-authoritative anchor (`startedAt`, `pausedAt`, `remainingAtPause`); clients render from the anchor plus a server-time offset from the WebSocket welcome message | The clock keeps correct time across reconnects, restarts and power loss |
| Development database | Embedded PostgreSQL binaries (`embedded-postgres`), forced to UTF-8 | No Docker or system install needed on the workstation; UTF-8 is enforced because Windows defaults to the ANSI code page |

## Deviations from the specification

- **Job queue.** The specification names a Redis/BullMQ-style queue. The worker instead polls
  PostgreSQL (outbox fan-out cursor, notification claims, backup runs). Delivery guarantees are the same
  or stronger because the queue lives in the same transaction as the business change.
- **Staff commands over Telegram.** Only read-only `/status` and, when the `telegramStaffCommands`
  flag is on, clock pause/resume with an explicit confirmation button are available. Finishing,
  resetting, cancelling and refunding are always refused in the bot (spec §29 safety default).
- **Kiosk and money.** The kiosk never takes payment. It creates the buy-in entry only for free
  tournaments or when the club enables `paidRegistration` (prepaid online); otherwise the player is
  sent to the cashier.
- **Cloud control plane.** Only the edge side of cloud sync is implemented (push of outbox events,
  pull of changes, conflict records and resolution). No cloud service is part of this repository; the
  protocol is documented in [EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md).
- **SMS and push notifications.** Channels exist in the model, but their transports are placeholders
  that report "not configured". Telegram, e-mail (SMTP) and the in-app inbox are implemented.

## Verification limits

- **Docker images were not built on the development workstation.** The workstation policy is that
  every tool lives in the project's `.venv` and nothing is installed system-wide; a Docker daemon
  (WSL2/Hyper-V) cannot be provided that way. The Docker CLI and Compose plugin in `.venv` validated
  `docker-compose.yml`, the real Caddy binary validated the `Caddyfile`, and `pnpm deploy` (used by the
  Dockerfile) was run locally. The first `docker compose up --build` on a Linux host is the remaining
  check.
- **Backups were verified end-to-end in development** with PostgreSQL 18 client tools: `pg_dump`
  produced a custom-format dump and `pg_restore` restored it into an empty database with identical
  row counts, the audit append-only trigger and the migration history.
- **External services are simulated in tests.** The end-to-end suite uses local stand-ins for the
  Telegram Bot API, the cloud gateway and the WAN probe that can be switched off to simulate an
  unplugged Internet cable. A real bot token and a real Telegram account were not used.
- **Camera QR scanning in the kiosk** relies on the browser's `BarcodeDetector`; it was not tested on
  kiosk hardware. Keyboard-wedge QR scanners and manual code entry work everywhere.

## Known limitations

| Limitation | Impact / workaround |
| --- | --- |
| The `notification.created` realtime event is declared but not emitted | The player inbox refreshes every 60 s instead of instantly |
| No delete endpoints for tournaments, leagues, seasons, series, score rules or house rules | Cancel tournaments instead; entities stay for history. Display templates can be deleted |
| `GET /audit` returns pages without a total count | The audit page offers "Newer/Older" paging |
| The notification queue counters on the Telegram page ignore the status/channel filters | Counters always show totals |
| No self-service password reset for players | Staff issue a one-time code or the player signs up again with the desk's help; staff passwords can be reset by an administrator |
| No public file endpoint for uploaded images | TV displays show the club name and a spade instead of an uploaded logo |
| Adding a staff role to an e-mail that already has a player account keeps that account's password and name | Intentional: an administrator cannot silently take over a player's login. The staff dialog warns about it |
| Public seat lists and seat events follow the `publicSeatList` flag | When the flag is off, players see only their own seat |
| The public live endpoint returns 404 for private or unpublished tournaments, while a venue TV display can still show them | Displays are trusted venue devices bound to a venue by a secret link |

## Open questions decided during implementation

- **Late registration closing** is evaluated from the rules at read time (`registrationOpen` in public
  data) and enforced in the command handlers; the stored `lateRegistrationClosed` flag only records a
  manual close.
- **Undo** is implemented as compensating actions recorded in the action history; the original action
  is never deleted. Actions whose effects were overtaken (for example an elimination after which the
  seat was reused) are reported as not undoable instead of being forced.
- **Notification time-to-live** is per type (for example a table move is useless after 5 minutes, a
  seat assignment after 20 minutes, a registration confirmation after a day). Expired messages are
  marked `EXPIRED` and never sent late.
- **Telegram identity** is the numeric Telegram user id. Usernames are stored only for display and are
  never used to authorise anything.
- **Paths in development** (`STORAGE_DIR`, `BACKUP_DIR`) are absolute, because the API and the worker
  run from different folders but must share files and backups. Production uses `/data/...` inside the
  containers.
