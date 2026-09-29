# HTTP API reference

The edge server exposes one JSON API under `/api/v1` (served by `apps/api`, NestJS on Fastify) plus
health endpoints and the local WebSocket described in [REALTIME.md](REALTIME.md). Behind the reverse
proxy everything is reachable on the venue hostname: `/api/*`, `/health*` and `/ws` go to the API,
all other paths to the web app (see [DEPLOYMENT.md](DEPLOYMENT.md)).

Source of truth: `apps/api/src/controllers/*.ts` (routes), `packages/core/src/services/*.ts`
(permissions and behaviour), `packages/types/src/schemas/*.ts` (request bodies).

## Conventions

### Authentication modes

Every route has one of four modes (`apps/api/src/http/decorators.ts`, enforced by
`http/context.guard.ts`):

| Mode | Who may call | Failure |
| --- | --- | --- |
| `public` | Anyone. A session is still resolved when a cookie is present | — |
| `session` | Any signed-in user (staff or player) | 401 `UNAUTHENTICATED` |
| `player` | A signed-in user with a player profile in the current club | 401 / 403 `FORBIDDEN` |
| `staff` (default) | A signed-in user with a staff role in the current club | 401 / 403 `FORBIDDEN` |

On top of the mode, services check a **permission** (`requirePermission`) and **tenant/venue
access** (`assertResourceAccess`, `venueScope`). Role → permission mapping:
`packages/types/src/permissions.ts`; see [SECURITY.md](SECURITY.md).

### Sessions, CSRF and Origin

- Sign-in (`POST /auth/login`, `/auth/signup`, `/auth/setup`, `/auth/telegram-miniapp`) sets the
  `pcos_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` unless `COOKIE_SECURE=false`, lifetime
  `SESSION_TTL_HOURS`). The response body is the `MeView`, which contains `csrfToken`.
- Every `POST`/`PUT`/`PATCH`/`DELETE` made with a session must send `X-CSRF-Token: <csrfToken>`
  (synchroniser token). Routes authenticated by other means (login, setup, webhook, kiosk token) skip
  this check.
- State-changing requests that carry an `Origin` header must come from the API's own host, the
  forwarded host, or `ALLOWED_ORIGINS`; otherwise 403 `CSRF_REJECTED`.

### Devices

Staff clients send `X-Device-Id: <uuid>` (plus optional `X-Device-Type`, `X-App-Version`). Every
authenticated staff request registers/refreshes that device in the registry; a revoked device gets
403 `DEVICE_REVOKED` whoever signs in on it. The device id is recorded in the audit log.

### Rate limits

A coarse per-IP limit of 1,500 requests per minute applies to every route (in-process or Redis);
login (per IP and per account), sign-up, first-run setup, Telegram link codes, kiosk PINs and
WebSocket upgrades have tighter limits. Exceeding a limit
returns 429 `RATE_LIMITED` with `Retry-After`.

### Errors

Errors are JSON: `{"error": {"code", "message", "details"?, "currentVersion"?}}`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body/query failed schema validation (`details` lists issues) |
| `UNAUTHENTICATED` | 401 | No or expired session |
| `FORBIDDEN` | 403 | Missing permission, other club/venue, wrong role |
| `CSRF_REJECTED` | 403 | Missing/invalid CSRF token or foreign `Origin` |
| `DEVICE_REVOKED` | 403 | The calling device was revoked by an administrator |
| `FEATURE_DISABLED` | 403 | The club switched the feature off (e.g. online registration, Telegram) |
| `NOT_FOUND` | 404 | Unknown resource (also used for resources of other clubs) |
| `VERSION_CONFLICT` | 409 | Optimistic concurrency failed; `currentVersion` is included |
| `INVALID_STATE` | 409 | Command not allowed in the current tournament status |
| `DUPLICATE` | 409 | Unique value already used (slug, email, member number…) |
| `IDEMPOTENCY_MISMATCH` | 409 | `clientOperationId` reused for a different request |
| `SETUP_REQUIRED` / `SETUP_ALREADY_COMPLETED` | 409 | First-run setup state |
| `CAPACITY_REACHED` | 409 | Tournament or table capacity reached |
| `RULE_VIOLATION` | 422 | A tournament rule forbids the action (e.g. late registration closed) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected error (logged with its root cause on the server) |

### Tournament commands, idempotency and concurrency

All live tournament mutations go through one endpoint:

```http
POST /api/v1/tournaments/{id}/commands
Content-Type: application/json
X-CSRF-Token: …

{ "type": "ELIMINATE_PLAYERS",
  "payload": { "entryIds": ["…"] },
  "expectedVersion": 41,
  "clientOperationId": "5b0f…-uuid" }
```

Response `200`: `{"actionId", "tournamentVersion", "duplicate", "result"}`.

- **Idempotency.** `clientOperationId` is unique per club. Retrying the same request returns the
  stored result with `duplicate: true` and changes nothing; reusing the id for a different request is
  `IDEMPOTENCY_MISMATCH`.
- **Concurrency.** `expectedVersion` is the tournament version the client last saw.
  `STRICT` commands (plans computed from a snapshot) require it to equal the current version.
  `REBASE` commands are accepted on a newer version when no action since `expectedVersion` touched the
  same entities (seat-level keys such as `seat:{table}:{n}`); otherwise `VERSION_CONFLICT`.
- **Clock guard.** Level-relative clock commands accept `fromLevelIndex`; if the clock has
  auto-advanced meanwhile, the command is rejected instead of skipping a level.
- Players may issue only `REGISTER_PLAYER` and `CANCEL_REGISTRATION` for themselves (through the
  `/public/tournaments/{id}/register|cancel` routes or the Telegram bot).

Every command is audited (`action = type`, actor, device, IP, payload, result, version) and produces
outbox events that are broadcast over the WebSocket after commit.

| Command | Payload | Permission | Mode |
| --- | --- | --- | --- |
| `PUBLISH`, `UNPUBLISH` | — | `tournament.publish` | REBASE |
| `OPEN_REGISTRATION` | — | `tournament.publish` | REBASE |
| `START_SEATING` | `draw` (default true) | `tournament.start` | STRICT |
| `START_TOURNAMENT` | — | `tournament.start` | REBASE |
| `FINISH_TOURNAMENT` | `finalOrder?` (entry ids, required for a deal) | `tournament.finalize` | STRICT |
| `REOPEN_TOURNAMENT` | `reason` | `tournament.finalize` | STRICT |
| `CANCEL_TOURNAMENT` | `reason` | `tournament.cancel` | STRICT |
| `CLOSE_LATE_REGISTRATION`, `REOPEN_LATE_REGISTRATION` | — | `tournament.clock.control` | REBASE |
| `START_HAND_FOR_HAND`, `END_HAND_FOR_HAND` | — | `tournament.clock.control` | REBASE |
| `PAUSE_CLOCK`, `RESUME_CLOCK` | — | `tournament.clock.control` | REBASE |
| `NEXT_LEVEL`, `PREVIOUS_LEVEL` | `fromLevelIndex?` | `tournament.clock.control` | REBASE |
| `SET_LEVEL` | `levelIndex` | `tournament.clock.control` | REBASE |
| `ADJUST_CLOCK` | `deltaSeconds`, `fromLevelIndex?` | `tournament.clock.control` | REBASE |
| `SET_REMAINING` | `remainingSeconds`, `fromLevelIndex?` | `tournament.clock.control` | REBASE |
| `REGISTER_PLAYER` | `playerId`, `source`, `reserveOnly` | `registration.create` | REBASE |
| `CANCEL_REGISTRATION` | `registrationId`, `reason?` | `registration.cancel` | REBASE |
| `CHECK_IN` | `registrationId`, `createEntry` (default true), `seat` (`AUTO`/`NONE`/`{tableId, seatNumber}`) | `registration.checkin` | REBASE |
| `UNDO_CHECK_IN`, `MARK_NO_SHOW` | `registrationId` | `registration.checkin` | REBASE |
| `PROMOTE_WAITLIST` | `registrationId` | `registration.create` | REBASE |
| `CREATE_ENTRY` | `registrationId`, `seat` | `entry.create` (+`entry.reentry` for re-entries) | REBASE |
| `REBUY`, `ADD_ON` | `entryId` | `entry.rebuy` | REBASE |
| `CHIP_ADJUSTMENT` | `entryId`, `chips`, `reason` | `entry.rebuy` | REBASE |
| `VOID_TRANSACTION` | `transactionId`, `reason` | `entry.void` | REBASE |
| `VOID_ENTRY` | `entryId`, `reason` | `entry.void` | REBASE |
| `ADD_TABLES` | `count`, `capacity?` | `table.manage` | REBASE |
| `CLOSE_TABLE` | `tableId` | `table.manage` | REBASE |
| `SET_SEAT_LOCK` | `tableId`, `seatNumber`, `locked`, `reason?` | `table.manage` | REBASE |
| `SET_DEALER_BUTTON` | `tableId`, `seatNumber` (nullable) | `table.manage` | REBASE |
| `APPLY_INITIAL_SEATING` | `moves` (planned) or `generate: true` | `seat.assign` | STRICT |
| `ASSIGN_SEAT` | `entryId`, `seat` | `seat.assign` | REBASE |
| `MOVE_PLAYER` | `entryId`, `fromTableId`, `fromSeatNumber`, `toTableId`, `toSeatNumber`, `reason` (`MANUAL`/`CORRECTION`) | `seat.move` | REBASE |
| `APPLY_BALANCE` | `moves` (from the balance preview) | `seat.move` | STRICT |
| `BREAK_TABLE` | `tableId`, `moves` (from the break preview) | `table.break` | STRICT |
| `ELIMINATE_PLAYERS` | `entryIds` (same hand, largest stack first), `eliminatedByEntryId?` | `player.eliminate` | REBASE |
| `RESTORE_PLAYER` | `entryId`, `reason` | `player.restore` | REBASE |
| `UNDO_ACTION` | `actionId`, `reason` | `player.restore` | REBASE |
| `FINALIZE_RESULTS` | — | `tournament.finalize` | STRICT |
| `CORRECT_RESULT` | `playerId`, `position`, `reason` | `results.correct` | REBASE |
| `DEALER_MARK_PRESENT` | `tableId`, `seatNumber`, `present` | `dealer.table.operate` | REBASE |
| `DEALER_REQUEST_FLOOR` | `tableId`, `message?` | `dealer.table.operate` | REBASE |
| `DEALER_REPORT_BUST` | `tableId`, `seatNumber` | `dealer.table.operate` | REBASE |
| `DEALER_CONFIRM_MOVEMENT` | `movementId` | `dealer.table.operate` | REBASE |
| `RESOLVE_FLOOR_REQUEST` | `requestId`, `resolution` (`ACKNOWLEDGED`/`RESOLVED`) | `seat.move` | REBASE |

Dealer commands from a device assigned to a table (Admin → Devices) are limited to that table unless
the user can also move seats. Which statuses allow which command: [TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md).

## Endpoints

Paths are relative to the host. "Staff" means the default staff mode; the permission column names the
permission checked by the service (blank: any staff member of the club).

### Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health/live` | public | Process is up |
| GET | `/health/ready` | public | `ready` when PostgreSQL answers, otherwise 503 `not_ready` |
| GET | `/health` | public | Overall state and component states (no secrets); 503 only when the overall state is `DOWN` — a lost WAN is `DEGRADED` |

### Authentication and account (`/api/v1/auth`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/auth/setup` | public | `{needsSetup}` for the first-run wizard |
| POST | `/auth/setup` | public, no CSRF | First-run setup with the one-time setup token: club, venue, edge node, owner account; signs in |
| POST | `/auth/login` | public, no CSRF | E-mail + password sign-in (optional `organizationSlug`) |
| POST | `/auth/signup` | public, no CSRF | Player self sign-up for a club (`acceptPrivacyPolicy` required) |
| POST | `/auth/logout` | session | Ends the session |
| GET | `/auth/me` | public | Current user, club, roles, permissions, venues, player profile, feature flags, `csrfToken` |
| POST | `/auth/switch-organization` | session | Switch the session to another club membership |
| POST | `/auth/change-password` | session | Change own password |
| POST | `/auth/telegram-miniapp` | public, no CSRF | Mini App sign-in with verified `initData` (linked players only) |

### Club, venues, staff (`/api/v1`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/organizations/current` | | Club and settings |
| PATCH | `/organizations/current` | `settings.manage` | Name, locale, timezone, currency, feature flags, notification types |
| GET | `/venues` | | Venues (restricted staff see only their venues) |
| POST | `/venues` | `venue.manage` | Create venue |
| PATCH | `/venues/{id}` | `venue.manage` | Update venue (only the fields sent) |
| GET | `/staff` | `staff.manage` | Staff list |
| POST | `/staff` | `staff.manage` | Add staff member (existing accounts keep their password) |
| PATCH | `/staff/{userId}` | `staff.manage` | Roles, venues, status, password |
| GET | `/roles` | | Roles and permission matrix |

### Devices (`/api/v1/devices`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/devices` | `device.manage` | Registered devices with live connection info |
| PATCH | `/devices/{id}` | `device.manage` | Rename, type, trusted, assigned dealer table |
| POST | `/devices/{id}/revoke` | `device.manage` | Revoke (signs out its sessions) |
| POST | `/devices/{id}/restore` | `device.manage` | Undo a revocation |
| POST | `/devices/{id}/disconnect` | `device.manage` | Close its WebSockets and sessions |

### Edge server (`/api/v1/edge`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/edge/status` | public | Edge/WAN/Telegram/cloud status (same payload as the WebSocket welcome) |
| GET | `/edge/health` | `edge.read` | Components, overall state |
| GET | `/edge/diagnostics` | `edge.read` | Redacted configuration, runtime, connected clients, cursors |
| GET | `/edge/network` | `edge.read` | Local URLs, IP fallback, QR codes for staff/player/admin |
| GET | `/edge/sync` | `edge.read` | Cloud sync counters and cursors |
| GET | `/edge/sync/conflicts` | `sync.manage` | Sync conflicts |
| POST | `/edge/sync/conflicts/{id}/resolve` | `sync.manage` | `KEEP_LOCAL` or `ACCEPT_REMOTE` |
| GET | `/edge/backups` | `backup.manage` | Backup runs |
| POST | `/edge/backups` | `backup.manage` | Request a backup now (the worker runs it) |

### Structures, templates, house rules (`/api/v1`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/structures` | `tournament.read` | Library structures with level counts |
| POST | `/structures` | `structure.manage` | Create (optionally generated) |
| GET | `/structures/{id}` | `tournament.read` | Structure with levels |
| PATCH | `/structures/{id}` | `structure.manage` | Rename / description |
| PUT | `/structures/{id}/levels` | `structure.manage` | Replace levels (version-checked; played levels locked) |
| POST | `/structures/{id}/duplicate` | `structure.manage` | Copy |
| DELETE | `/structures/{id}` | `structure.manage` | Delete a library structure not used by any tournament or template |
| GET/POST | `/templates` | `tournament.read` / `tournament.create` | Tournament templates |
| GET/PUT/DELETE | `/templates/{id}` | `tournament.read` / `tournament.create` | Read, update, delete a template |
| POST | `/templates/{id}/tournaments` | `tournament.create` | Create a tournament from a template |
| GET | `/house-rules` | `tournament.read` | House rules profiles |
| POST, PUT | `/house-rules`, `/house-rules/{id}` | `settings.manage` | Create / update a profile |

### Tournaments (`/api/v1/tournaments`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/tournaments` | `tournament.read` | List; query `q`, `status` (comma list), `venueId`, `from`, `to`, `limit`, `offset` |
| POST | `/tournaments` | `tournament.create` | Create (copies the structure and house rules into the tournament) |
| GET | `/tournaments/{id}` | `tournament.read` | Detail |
| PATCH | `/tournaments/{id}` | `tournament.edit` | Change configuration (only fields sent; `expectedVersion` required; limited while running) |
| GET | `/tournaments/{id}/snapshot` | `tournament.read` | Full staff snapshot: tournament, clock, levels, stats, tables, registrations, entries, floor requests, announcements |
| POST | `/tournaments/{id}/commands` | per command | See above |
| GET | `/tournaments/{id}/actions` | `tournament.read` | Action history with undo availability |
| GET | `/tournaments/{id}/movements` | `tournament.read` | Seat movements (dealer arrivals) |
| GET | `/tournaments/{id}/results` | `results.read` | Standings |
| GET | `/tournaments/{id}/results.csv` | `results.read` | CSV export |
| GET | `/tournaments/{id}/seating/preview` | `seat.assign` | Initial seating plan |
| GET | `/tournaments/{id}/balance/preview` | `seat.move` | Imbalance analysis and proposed moves |
| GET | `/tournaments/{id}/break/preview` | `table.break` | Table-break recommendation and moves (`tableId` optional) |
| GET | `/tournaments/{id}/qr` | `tournament.read` | QR codes (registration, live page, Telegram deep link) |

### Players, CRM and imports (`/api/v1`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/players` | `player.read` | Search (`q`, `tag`, `status`, `limit`, `offset`) with total |
| POST | `/players` | `player.create` | Create |
| GET | `/players/{id}` | `player.read` | Profile, tags, notes, consents, Telegram, history, stats |
| PATCH | `/players/{id}` | `player.edit` | Update (only fields sent; `expectedVersion` required) |
| POST | `/players/{id}/anonymize` | `player.edit` + `settings.manage` | Erase personal data, keep results |
| POST | `/players/{id}/notes` | `player.notes.write` | Add note |
| POST / DELETE | `/players/{id}/tags`, `/players/{id}/tags/{tagId}` | `player.edit` | Tag / untag |
| POST | `/players/{id}/consents` | `player.edit` | Record a consent change |
| POST | `/players/{id}/kiosk-pin` | `player.edit` | Set kiosk PIN |
| POST | `/players/{id}/one-time-code` | `registration.checkin` | Issue a kiosk one-time code |
| GET | `/player-tags` | `player.read` | Tags |
| POST | `/imports/players` | `player.import` | Upload CSV |
| GET | `/imports/{id}` | `player.import` | Import job |
| POST | `/imports/{id}/mapping`, `/validate`, `/apply` | `player.import` | Map columns, dry run, import |
| GET | `/exports/players.csv` | `player.export` | CSV export |

### Leagues (`/api/v1`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/score-rules` | `tournament.read` | Score rules |
| POST, PUT | `/score-rules`, `/score-rules/{id}` | `league.manage` | Create / update |
| POST | `/score-rules/preview` | `tournament.read` | Points for a sample field (nothing stored) |
| GET / POST / PUT | `/leagues`, `/leagues/{id}` | `tournament.read` / `league.manage` | Leagues |
| POST, PUT | `/leagues/{id}/seasons`, `/leagues/{id}/seasons/{seasonId}` | `league.manage` | Seasons |
| GET / POST / PUT | `/series`, `/series/{id}` | `tournament.read` / `league.manage` | Series |
| GET | `/seasons/{id}/leaderboard` | `tournament.read` | Latest leaderboard snapshot |
| POST | `/seasons/{id}/recalculate` | `league.manage` | Recompute |

### Announcements, notifications, Telegram (`/api/v1`)

| Method | Path | Auth / permission | Purpose |
| --- | --- | --- | --- |
| GET | `/announcements` | `tournament.read` | Announcements |
| POST | `/announcements` | `announcement.create` | Publish to TVs, player pages, Telegram |
| GET | `/notifications/queue` | `telegram.manage` | External notification queue and counters |
| GET | `/notifications/{id}/deliveries` | `telegram.manage` | Telegram delivery attempts |
| GET / PUT | `/telegram/integration` | `telegram.manage` | Bot settings (token write-only) |
| POST | `/telegram/test` | `telegram.manage` | Send a test message to the staff chat |
| GET | `/telegram/link` | session | Link status of the current account |
| POST | `/telegram/link` | session | Create a single-use deep link (15 min) |
| POST | `/telegram/link/code` | session | Link with a code issued by the bot's `/link` |
| DELETE | `/telegram/link` | session | Unlink |
| POST | `/telegram/webhook/{organizationId}` | public, secret header | Updates in `CLOUD_WEBHOOK` mode (`X-Telegram-Bot-Api-Secret-Token`) |

### Displays and kiosks (`/api/v1`)

| Method | Path | Auth / permission | Purpose |
| --- | --- | --- | --- |
| GET | `/display-templates` | `tournament.read` | Display templates |
| POST, PUT, DELETE | `/display-templates`, `/display-templates/{id}` | `display.manage` | Manage templates (deleting falls back to the default layout) |
| GET | `/display-tokens` | `display.manage` | Display and kiosk links (never the token itself) |
| POST | `/display-tokens` | `display.manage` | Create a link; the token and path are returned once |
| POST | `/display-tokens/{id}/revoke` | `display.manage` | Revoke |
| GET | `/display/{token}/state` | display/kiosk token | Template, venue, current tournament and public snapshot |
| POST | `/kiosk/{token}/check-in` | kiosk token | Self check-in by QR code, member number + PIN, or one-time code |

### Audit and reports (`/api/v1`)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/audit` | `audit.read` | Audit log with filters (action, entity, tournament, actor, dates, paging) |
| GET | `/reports/dashboard` | `analytics.read` | Today's dashboard |
| GET | `/reports/analytics` | `analytics.read` | Analytics for `from`/`to` (default: last 180 days to tomorrow) |

### Public and player routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/public/orgs/{slug}/tournaments` | public | Published schedule; `past=1` includes finished; each item has `registrationOpen` |
| GET | `/api/v1/public/orgs/{slug}/leaderboards` | public | Public league tables |
| GET | `/api/v1/public/tournaments/{idOrSlug}/live` | public | Public live snapshot (clock, stats, seating if public, results, own seat/registration when signed in) |
| POST | `/api/v1/public/tournaments/{id}/register` | player | Self registration (`source`: `PLAYER_WEB`, `PLAYER_QR`, `TELEGRAM_MINI_APP`) |
| POST | `/api/v1/public/tournaments/{id}/cancel` | player | Cancel own registration |
| GET | `/api/v1/me/registrations` | player | Own upcoming registrations |
| GET / PATCH | `/api/v1/me/profile` | player | Own profile (incl. language) / update allowed fields |
| POST | `/api/v1/me/one-time-code` | player | Kiosk one-time code |
| GET | `/api/v1/me/notifications` | player | In-app inbox |
| POST | `/api/v1/me/notifications/read` | player | Mark read (`ids` or `"all"`) |
| GET / PUT | `/api/v1/me/notification-preferences` | player | Per type and channel preferences |

## Not provided

Tournament, league, season, series, score-rule and house-rule deletion; self-service password reset;
a public file endpoint for uploaded images; total counts for the audit list. See
[ASSUMPTIONS.md](ASSUMPTIONS.md).
