# Security

This document describes the security controls that exist in the code of Poker Club OS and
their known limits. Network exposure, TLS and firewalling are covered in
[NETWORK_SECURITY.md](NETWORK_SECURITY.md); personal data in [PRIVACY.md](PRIVACY.md);
Telegram specifics in [TELEGRAM.md](TELEGRAM.md).

Key sources: `packages/core/src/services/auth.service.ts`, `packages/core/src/crypto.ts`,
`apps/api/src/http/*`, `apps/api/src/server.ts`, `apps/api/src/realtime/hub.ts`,
`packages/types/src/permissions.ts`, `packages/domain/src/access.ts`, `packages/core/src/actor.ts`,
`packages/core/src/audit.ts`, `packages/db/drizzle/0001_audit_append_only.sql`, `apps/web/next.config.ts`.

---

## 1. Threat model summary

**Assets:** live tournament state and results (integrity and availability during an event),
player personal data, staff accounts, the Telegram bot token, backups.

| Threat | Main controls |
|---|---|
| Hostile or curious device on the venue Wi-Fi (players share the network) | The LAN is **not trusted**: every request is authenticated and authorised the same way as from the Internet (`apps/api/src/http/context.ts`); per-IP rate limits; only the reverse proxy is exposed |
| Cross-site attacks from a web page a staff member opens | `SameSite=Lax` httpOnly cookie, synchronizer CSRF token, Origin checks for HTTP and WebSocket, CSP / frame denial |
| Stolen or lost tablet | Server-side session revocation, device revocation, password change revokes other sessions ([NETWORK_SECURITY.md](NETWORK_SECURITY.md#11-if-a-tablet-is-stolen)) |
| Insider mistakes or abuse | Fine-grained RBAC, venue restrictions, append-only audit log, reasons required for corrections, undo via compensating actions |
| Double submissions, retries, concurrent floor staff | Idempotency keys, row locks, optimistic versions with rebase, DB unique constraints |
| Guessing tokens and codes | Long random tokens (sessions 256 bit, display/kiosk/Telegram deep links 192 bit, setup ≈ 90 bit) stored only as SHA-256 hashes; short codes (Telegram link code, kiosk PIN, kiosk one-time code) are rate limited (§4) |
| Leaked database or backup | Passwords/PINs hashed with argon2id; tokens hashed; bot token encrypted (AES-256-GCM) |
| Internet attackers | No inbound port is required: Telegram uses outbound long polling, cloud sync is outbound and off by default |

Out of scope of the code: host OS hardening, physical security of the edge server, Wi-Fi
configuration, disk encryption. See [NETWORK_SECURITY.md](NETWORK_SECURITY.md) and
[EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md).

## 2. Authentication

### 2.1 Passwords

| Item | Value (as coded) |
|---|---|
| Algorithm | argon2id via `@node-rs/argon2` |
| Parameters | `memoryCost: 19456` KiB (19 MiB), `timeCost: 2`, `parallelism: 1` (`packages/core/src/crypto.ts`) |
| Length | 10–256 characters (`Password` schema, `packages/types/src/schemas/auth.ts`); no composition or breached-password check |
| Unknown e-mail | A dummy argon2 hash is computed so timing is similar to a wrong password |
| Lockout | 10 consecutive failures lock the account for 15 minutes; a successful login resets the counter |
| Kiosk PINs | 4–8 digits, hashed with the same argon2id parameters |

Staff accounts are created by staff with `staff.manage`; players sign up themselves on
`/p/<org>/signup` (requires `playerRegistration`). Players created at the desk may get a
password-less account when they first sign in through the Telegram Mini App
([TELEGRAM.md](TELEGRAM.md#9-mini-app)).

### 2.2 Sessions

- The session token is 32 random bytes (base64url) sent only in the cookie; the database stores
  its **SHA-256 hash** (`sessions.token_hash`).
- Each session has its own CSRF token (24 random bytes) returned by `GET /api/v1/auth/me`.
- A session is bound to one organization; `POST /api/v1/auth/switch-organization` requires an
  active membership or player profile there (or super admin).
- Lifetime: `SESSION_TTL_HOURS` (default **336 h = 14 days**, allowed 1–2160). Expiry is absolute
  from creation (no sliding renewal). `last_seen_at` is refreshed at most once a minute.
- Session kinds: `STAFF` (login, setup), `PLAYER` (sign-up), `TELEGRAM` (Mini App).
- IP address, user agent (first 300 chars) and device ID are stored with the session.

### 2.3 Cookie

`apps/api/src/http/cookies.ts`: name `pcos_session`, `HttpOnly`, `Secure` (unless `COOKIE_SECURE=false`,
used only for local development), `SameSite=Lax`, `Path=/`, host-only (no `Domain`),
`Max-Age = SESSION_TTL_HOURS × 3600`.

### 2.4 Logout and revocation

| Event | Effect |
|---|---|
| `POST /api/v1/auth/logout` | Session revoked, cookie cleared |
| Own password change | All **other** sessions of the user revoked (not audited, see §16) |
| Staff update with new roles, new password or status `DISABLED` | All sessions of that user **in this organization** revoked; `session.revoked` event closes the user's WebSockets |
| Device revoked / disconnected (`/admin/devices`) | All sessions created with that device ID revoked; the device's staff WebSockets closed |
| User status not `ACTIVE`, membership not `ACTIVE` | Session no longer resolves / no staff principal |
| Open WebSockets | Re-validated every 60 s and closed with code 4401 when the session is gone |
| Housekeeping | Session rows deleted 7 days after expiry or revocation |

## 3. CSRF protection

Three layers (`apps/api/src/http/context.guard.ts`):

1. **SameSite=Lax cookie** — not sent on cross-site POST/PUT/PATCH/DELETE.
2. **Synchronizer token** — every unsafe request with a session must carry `X-CSRF-Token`
   equal to the session's token (constant-time compare), otherwise `CSRF_REJECTED`.
3. **Origin check** — for unsafe methods, if an `Origin` header is present its host must equal the
   request `Host`, the first `X-Forwarded-Host`, or a host from `ALLOWED_ORIGINS`. Requests without
   `Origin` (non-browser clients) pass this layer.

Endpoints that skip the token (layer 2) because they are authenticated otherwise or precede a
session: setup, login, sign-up, Telegram Mini App sign-in, Telegram webhook (secret header), kiosk
check-in (token in URL). The Origin check still applies to them. No CORS headers are sent, so other
origins cannot read API responses.

## 4. Rate limits

Fixed-window counters, shared through Redis when available, in-process otherwise
(`packages/core/src/infra/rate-limiter.ts`). Keys use the client IP as resolved through
`TRUST_PROXY` ([NETWORK_SECURITY.md](NETWORK_SECURITY.md#4-trust_proxy-and-x-forwarded-for)).

| Scope | Limit | Where |
|---|---|---|
| Any API request | 1500 / 60 s per IP | `context.guard.ts` |
| Login | 30 / 5 min per IP **and** 8 / 5 min per e-mail+IP | `auth.service.ts` |
| Player sign-up | 10 / hour per IP | `auth.service.ts` |
| Setup | 10 / 15 min per IP (checked after a valid token; see §16) | `auth.service.ts` |
| Telegram link code entry | 10 / 15 min per user | `telegram.service.ts` |
| Kiosk check-in | 60 / min per kiosk token | `display.service.ts` |
| Kiosk member PIN | 5 / 15 min per member number | `display.service.ts` |
| WebSocket upgrades | 120 / min per IP; max 64 concurrent sockets per IP | `hub.ts` |
| WebSocket subscriptions | 64 per connection; 8 KiB max message | `hub.ts` |

HTTP body limit is 12 MiB and request timeout 30 s (`apps/api/src/server.ts`). A `429` response carries
`Retry-After`.

## 5. RBAC

Authorization is permission-based. Roles map to permission sets in
`packages/types/src/permissions.ts`; system roles are seeded into `roles`/`role_permissions` at start-up.
The check is `hasPermission` (`packages/domain/src/access.ts`): staff principals only; users with
`is_super_admin` pass every check.

Principal kinds: `staff`, `player`, `display`, `kiosk`, `anonymous`, plus the internal `system`
actor (worker, verified kiosk flow).

### 5.1 Roles and key permissions

| Role | Key permissions | Notably without |
|---|---|---|
| `SUPER_ADMIN` | all | — (cannot be assigned through the API) |
| `ORGANIZATION_OWNER` | all (48 permissions) | — |
| `MANAGER` | all except `organization.manage` (incl. `staff.manage`, `settings.manage`, `backup.manage`, `sync.manage`, `telegram.manage`, `device.manage`, `player.export`, `player.import`, `audit.read`) | renaming the organization, granting the owner role |
| `TOURNAMENT_DIRECTOR` | `tournament.*` (read, create, edit, publish, start, clock.control, finalize, cancel), `structure.manage`, all registration / entry / seat / table commands, `player.read/create/edit/eliminate/restore`, `player.notes.read/write`, `results.read/correct`, `announcement.create`, `telegram.announce`, `display.manage`, `audit.read`, `edge.read`, `dealer.table.operate` | staff, settings, devices, Telegram setup, leagues, analytics, import/export, backups |
| `FLOOR_MANAGER` | `tournament.read`, `tournament.clock.control`, `registration.read/create/checkin`, `entry.create/rebuy/reentry`, `seat.assign/move`, `table.manage/break`, `player.eliminate/restore/read/create`, `results.read`, `announcement.create`, `edge.read`, `dealer.table.operate` | publish/start/finish/finalize/cancel, `registration.cancel`, `entry.void`, `player.edit`, notes |
| `REGISTRATION_STAFF` | `tournament.read`, `registration.read/create/cancel/checkin`, `entry.create`, `entry.reentry`, `seat.assign`, `player.read/create/edit` | clock, rebuys, voids, moves |
| `CASHIER` | `tournament.read`, `registration.read/checkin`, `entry.create/rebuy/reentry/void`, `player.read` | clock, seating moves, player edits |
| `DEALER` | `tournament.read`, `dealer.table.operate` | player data (check-in codes and member numbers are blanked in its snapshot) |
| `MARKETING_MANAGER` | `tournament.read`, `player.read`, `player.export`, `results.read`, `league.manage`, `announcement.create`, `telegram.announce`, `analytics.read` | any live tournament command |
| `READ_ONLY_ANALYST` | `tournament.read`, `registration.read`, `player.read`, `results.read`, `analytics.read`, `edge.read` | any write |
| `PLAYER` | none (self-service only) | — |

Each tournament command requires one permission (`COMMAND_PERMISSIONS` in
`packages/types/src/schemas/commands.ts`), e.g. `CHIP_ADJUSTMENT` requires `entry.rebuy`,
`UNDO_ACTION` requires `player.restore`, `RESOLVE_FLOOR_REQUEST` requires `seat.move`.

### 5.2 Additional rules

- Players may issue only `REGISTER_PLAYER` and `CANCEL_REGISTRATION` for **their own** player record;
  display and kiosk tokens cannot issue commands (`executor.ts`).
- Re-entries additionally need `entry.reentry`; a check-in that creates an entry needs `entry.create`.
- Player anonymization needs `player.edit` **and** `settings.manage`.
- `MANAGEMENT`-visibility player notes need `staff.manage` to write and to read.
- Role assignment (`org.service.ts`): `SUPER_ADMIN` and `PLAYER` cannot be assigned; only an owner
  (or super admin) can grant `ORGANIZATION_OWNER` or modify an owner; the last active owner cannot
  be removed or disabled.
- Custom roles: permissions of non-system role keys are read from `roles`/`role_permissions` for the
  organization. There is no API to create or edit them.
- The web UI hides navigation by permission, but **every API call is authorised again server-side**.

## 6. Tenant and venue isolation

- Every tenant-owned table carries `organization_id`; services always filter by the actor's
  organization (`requireOrganization`), so resources of other organizations return `404`.
- `assertResourceAccess` / `canAccessVenue` (`packages/core/src/actor.ts`, `packages/domain/src/access.ts`)
  additionally enforce **venue restrictions**: `organization_members.venue_ids` (`null` = all venues).
  Enforced for tournaments (list, read, all commands), venue list/update, display and kiosk tokens,
  announcements and realtime topics (`venue`, `tournament`, `table`, `display`).
- Organization-wide (not restricted by venue): player CRM, structures and templates, leagues, audit
  log, analytics, notification queue, devices, Telegram, backups.
- Display and kiosk tokens are bound to one venue and optionally one tournament.
- Realtime subscriptions are authorised per topic ([REALTIME.md](REALTIME.md)); anonymous and player
  connections only receive `public`-audience events of published, non-`PRIVATE` tournaments.

## 7. Audit log

- `writeAudit` (`packages/core/src/audit.ts`) records organization, venue, tournament, actor user,
  actor kind (`USER`/`SYSTEM`/`DEVICE`/`ANONYMOUS`), device ID, IP, entity, action, `before`/`after`
  JSON, metadata with the channel (`WEB`, `TELEGRAM`, `KIOSK`, `SYSTEM`, …) and the edge node.
- Audited: login and failed login (with the attempted e-mail and reason), setup, player sign-up,
  **every tournament command** (payload, result, version) plus handler-level entries (undo, restore,
  void, result correction, cancel/reopen reasons, capacity overrides), player create/update/anonymize,
  notes, consents, kiosk PIN set, self-service profile changes, staff and settings changes, venues,
  devices, display tokens and templates, structures, tournaments, Telegram integration and
  (un)linking, announcements, imports, exports (`DATA_EXPORTED`), backup requests, sync conflict
  resolution, leaderboard recalculation.
- **Append-only**: migration `0001_audit_append_only.sql` installs triggers that reject `UPDATE`,
  `DELETE` and `TRUNCATE` on `audit_logs` unless the transaction sets
  `SET LOCAL pcos.allow_history_mutation = 'on'`. No application code sets it; housekeeping never
  touches the audit log.
- Viewing: `/admin/audit` and `GET /api/v1/audit` (`audit.read`), filterable by action, entity type,
  tournament, actor and time range.
- Limits: the trigger protects against application bugs, not against a database superuser (the
  Compose `POSTGRES_USER` is a superuser that owns the tables and could disable the trigger).

## 8. First-run setup token

- While the `users` table is empty, the API generates a one-time token of three groups of six
  characters from a 32-character alphabet (≈ 90 bits) and prints it **only on the API console**
  (`docker compose logs api`). Alternatively the operator sets `SETUP_TOKEN` (the setup form requires
  at least 16 characters).
- Only the SHA-256 of the token is stored (`system_kv.setup.tokenHash`); comparison is constant-time.
- Setup creates the organization, venue, edge node, owner account and defaults in one transaction,
  deletes the token hash and records `SETUP_COMPLETED`. Any later attempt returns
  `SETUP_ALREADY_COMPLETED`.

## 9. Secrets at rest

| Secret | Storage |
|---|---|
| Telegram bot token (entered on `/admin/telegram`) | AES-256-GCM (`SecretBox`, 12-byte random IV, format `v1.<iv>.<tag>.<ciphertext>`) in `telegram_integrations.encrypted_bot_token`. Key = scrypt(`SECRETS_ENCRYPTION_KEY`, or SHA-256 of `pcos-secrets:` + `SESSION_SECRET`). Never returned by the API, never written to the audit log; the Telegram client redacts it from error messages |
| Telegram bot token from env | `TELEGRAM_BOT_TOKEN` in `.env` |
| Passwords, kiosk PINs | argon2id hashes |
| Session, display/kiosk, setup, Telegram link tokens and codes, kiosk one-time codes | SHA-256 hashes only |
| CSRF tokens | Plain, per session (not a credential on their own) |
| Database, SMTP, cloud sync, S3 credentials, `SESSION_SECRET` | `.env` (created with mode 600 by `deploy/scripts/install-edge.sh`) |

`SESSION_SECRET` (≥ 32 chars) is used only to derive the secret-box key when
`SECRETS_ENCRYPTION_KEY` is unset. Changing it makes a stored bot token undecryptable; the
integration then behaves as "no token" until the token is entered again. The diagnostics bundle
(`GET /api/v1/edge/diagnostics`, `edge.read`) replaces values of keys matching
`SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL|REDIS_URL|DSN` with `<set>`/`<unset>`.

The database files and `pg_dump` backups are **not encrypted** by the application; use disk
encryption and an encrypting off-site tool such as restic ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)).

## 10. Device identity, display and kiosk tokens

**Staff devices** (`packages/core/src/services/device.service.ts`)

- Browsers generate a device UUID (stored in `localStorage`) and send `X-Device-Id`,
  `X-Device-Type`, `X-App-Version`. Signed-in staff requests register/refresh the device (at most once
  per minute).
- A **revoked** device receives `DEVICE_REVOKED` on every staff request carrying its ID, its sessions
  are revoked and its WebSockets closed. **Disconnect** revokes the sessions only.
- `trusted` is an informational label; it does not change authorization.
- `assigned_table_id` limits dealer-only users to that table for dealer commands and table topics.
- Device identity is supplementary audit context, never authentication: a browser that clears its
  storage gets a new ID, and the table limit does not apply to requests without `X-Device-Id`.

**TV display and kiosk tokens** (`packages/core/src/services/display.service.ts`)

- 24 random bytes (base64url, 32 chars). Only the SHA-256 hash and the first 6 characters (to
  recognise it) are stored. The plaintext link is shown **once** when created.
- A display token grants read-only public tournament data for its venue (and bound tournament);
  a kiosk token additionally allows `POST /api/v1/kiosk/<token>/check-in` and nothing else.
- Kiosk check-ins run as the internal actor `kiosk:<name>` (channel `KIOSK`) through the normal
  command executor and are audited. **A kiosk never takes money.**
- Revocation (`/admin/displays`) takes effect immediately for HTTP; see §16 for open WebSockets.

## 11. Integrity controls: idempotency and concurrency

Implemented in `packages/core/src/tournaments/executor.ts`
([TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md), [OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)):

- **Idempotency**: every command carries a client-generated `clientOperationId` (UUID). It is unique
  per organization (`op_actions_idempotency_uq`) together with a hash of tournament, type and payload.
  A retry returns the stored result with `duplicate: true`; reusing the ID for a different request
  fails with `IDEMPOTENCY_MISMATCH`. The check runs before and inside the transaction, and a
  concurrent insert race is resolved via the unique constraint.
- **Serialization**: the tournament row is locked `FOR UPDATE` for the whole command.
- **Optimistic versions**: `STRICT` commands (seat draw plans, balance, table break, finish,
  finalize, cancel, reopen) require `expectedVersion` to equal the current version; `REBASE` commands
  are accepted on newer versions unless an action since then touched the same entities
  (`affected_keys`), otherwise `VERSION_CONFLICT`.
- **Database constraints**: one active seat assignment per seat and per entry, one active entry per
  player, one live registration per player per tournament, unique check-in codes.
- **Atomic side effects**: operational action, audit entries and outbox events are written in the
  same transaction; realtime notifications (`pg_notify`) are delivered only after commit; no external
  call happens inside the transaction.
- Corrections are new records (undo = compensating action, voids = `VOID` transactions, result
  corrections carry a revision). Only `audit_logs` is protected by a trigger.
- Telegram updates are processed once per `update_id`; bot actions use deterministic operation IDs
  ([TELEGRAM.md](TELEGRAM.md#6-idempotency)).

## 12. WebSocket security

Summary (details in [REALTIME.md](REALTIME.md) and [NETWORK_SECURITY.md](NETWORK_SECURITY.md#5-websocket-origin-checks-cswsh)):
cookie-authenticated upgrades must pass the Origin check (cross-site WebSocket hijacking protection);
display/kiosk sockets authenticate with the token in the query string; each topic subscription is
authorised individually; events are filtered by audience (`public`/`staff`); sessions are
re-validated every 60 s; per-IP connection and upgrade limits apply.

## 13. Security headers and CSP

| Layer | Headers |
|---|---|
| Caddy (`deploy/caddy/Caddyfile`) | HTTP→HTTPS redirect, `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Server` removed; admin API bound to `localhost` inside the container |
| API (`apps/api/src/server.ts`, Helmet) | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-site`, other Helmet defaults; HSTS left to the proxy; `Cache-Control: no-store` on every `/api/` response and every error |
| Web (`apps/web/next.config.ts`) | CSP `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (+ `https://telegram.org` on `/tg`); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `connect-src 'self' ws: wss:`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'` (on `/tg/*`: `'self' https://web.telegram.org https://*.telegram.org`); `X-Frame-Options: DENY` except `/tg`; `Referrer-Policy: same-origin`; `Permissions-Policy: camera=(self), microphone=(), geolocation=()`; `X-Content-Type-Options: nosniff`; no `X-Powered-By` |

Development builds add `'unsafe-eval'` and `http://localhost:4000` to the CSP. The service worker
never caches `/api`, `/ws` or `/health`.

## 14. Telegram

Bot token handling, webhook secret verification (`X-Telegram-Bot-Api-Secret-Token`, constant time),
Mini App `initData` HMAC verification (max age 1 hour), account linking and staff command safety are
described in [TELEGRAM.md](TELEGRAM.md).

## 15. Dependencies and updates

- Node.js ≥ 24, pnpm 12.4.1 (Corepack). Docker builds use `pnpm fetch` (which installs exactly what
  `pnpm-lock.yaml` lists) and an offline `--frozen-lockfile` install.
- `pnpm-workspace.yaml` limits which packages may run install scripts (`allowBuilds`) and lists the
  only exceptions to pnpm's minimum-release-age policy (`minimumReleaseAgeExclude`).
- Runtime images: `node:24-bookworm-slim` (API, worker, web run as the `node` user),
  `postgres:18-bookworm`, `redis:8-alpine`, `caddy:2`, optional `minio/minio:latest`. The worker image
  installs `postgresql-client-18` from the signed PGDG repository. Tags float: pin digests if you need
  reproducible images. Next.js and Turborepo telemetry are disabled in the build.
- Updating: back up first, then rebuild and restart (`docker compose up -d --build`); with
  `AUTO_MIGRATE=true` the API and worker apply migrations on start. See [DEPLOYMENT.md](DEPLOYMENT.md)
  and [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).
- The repository contains no automated dependency scanning; run `pnpm audit` and rebuild images
  regularly.

## 16. Known limitations

- Account lockout (§2.1) can be triggered by anyone who knows a staff e-mail and can reach the
  server; a locked owner cannot sign in for 15 minutes.
- Wrong setup tokens are counted but not blocked by the setup rate limit; rely on the token's length.
- Revoking a display or kiosk token does not close a WebSocket that is already open; the device keeps
  receiving public events until it reconnects (e.g. restart of the API).
- WebSocket re-validation checks that the session still exists, not role or organization changes
  made without revoking it (role changes do revoke sessions).
- Not audited: own password change, logout, Telegram Mini App sign-in, player tag changes,
  notification preference changes, kiosk one-time code issuance.
- The web CSP allows inline scripts and WebSocket connections to any host.
- The diagnostics redaction does not cover values such as `OFFSITE_BACKUP_COMMAND` or
  `CLOUD_API_URL`; do not embed credentials in them.
- `users` are global across organizations: a manager of one organization can reset the password of a
  user who is also a member elsewhere (relevant only for multi-organization edges).

## 17. Reporting security issues

This repository does not define a security contact. Operators and maintainers should add one here.
Until then: report privately to the maintainers of your deployment (not in a public issue tracker),
include the affected version (`SOFTWARE_VERSION`), steps to reproduce and impact, and never attach
real player data, `.env` files or backups. The diagnostics bundle from `/admin/health` is
redacted as described in §9 — review it before sharing.
