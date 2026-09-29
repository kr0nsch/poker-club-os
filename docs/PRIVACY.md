# Privacy

What personal data Poker Club OS processes, where it lives, who sees it, what leaves the
venue and how long it is kept. The club operating the system is the controller of this data;
this document gives **operator guidance, not legal advice** (GDPR, Russian Federal Law 152-FZ
"On Personal Data" and similar laws). Check the current legal requirements for your jurisdiction.

Related: [SECURITY.md](SECURITY.md) · [TELEGRAM.md](TELEGRAM.md) · [EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md) ·
[BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) · [DOMAIN_MODEL.md](DOMAIN_MODEL.md)

---

## 1. Personal data inventory

All data is stored in the PostgreSQL database on the Venue Edge Server unless stated otherwise.

| Category | Fields | Table / location | Source |
|---|---|---|---|
| Player identity | first name, last name, display name, nickname, public ID (`P-XXXXXXXX`), member number | `players` | staff, self sign-up, CSV import, cloud sync |
| Player contact | e-mail, phone | `players` | same |
| Player profile | language, country (ISO-2), date of birth, status (`ACTIVE`/`INACTIVE`/`BANNED`/`MERGED`), source | `players` | same (date of birth and country only via staff/import) |
| Kiosk credential | kiosk PIN (argon2id hash) | `players.kiosk_pin_hash` | staff |
| Consent flags and history | `marketing_consent`, `public_profile_enabled`; consent rows (type, granted, source, recorded by, time) | `players`, `player_consents` | sign-up, staff, player profile |
| Staff notes and tags | free-text notes (`STAFF`/`MANAGEMENT` visibility, author), tags | `player_notes`, `player_tags`, `player_tag_links` | staff |
| Competition history | registrations (status, source, check-in code, times), entries, rebuys/add-ons with recorded amounts, seats and moves, eliminations (incl. eliminator), results, points | `tournament_registrations`, `tournament_entries`, `entry_transactions`, `tournament_seat_assignments`, `seat_movements`, `tournament_results` | operations |
| League standings | copies of display names with rank and points | `leaderboard_snapshots.rows` | finalisation / recalculation |
| Accounts | e-mail, display name, password hash, status, last login, failed-login counter | `users` | staff creation, sign-up, Mini App |
| Sessions | IP address, user agent, device ID, timestamps | `sessions` | sign-in |
| Devices | device ID, last IP, user agent, current user, assigned table | `devices` | staff browser headers |
| Telegram | Telegram user ID, chat ID, username, link times; followed tournaments; link tokens/codes | `telegram_account_links`, `telegram_subscriptions`, `telegram_link_tokens` | account linking, bot |
| Notifications | type, payload (tournament name, seat, position…), recipient (Telegram chat ID or e-mail), delivery log | `notifications`, `telegram_deliveries` | system |
| Notification preferences | per type and channel | `notification_preferences` | player (web, bot) |
| Audit log | actor, IP, device ID, `before`/`after` snapshots (may contain player fields), attempted e-mail of failed logins | `audit_logs` | system |
| Outbox events | event payloads, e.g. player records for sync, display names in tournament events | `outbox_events` | system |
| Sync conflicts | local and remote payloads (may contain player records) | `sync_conflicts` | cloud sync |
| Imports | uploaded CSV files; first 5 rows as preview | files under `STORAGE_DIR/imports/`, `import_jobs.preview` | staff |
| Floor requests, announcements | free text written by dealers/staff | `floor_requests`, `announcements` | staff |
| Browser | device ID, device type, UI language | `localStorage` on each device | client |
| Backups | everything above | `pg_dump` files in `BACKUP_DIR` (and off-site copy if configured) | worker |

Not collected: payment card data, government IDs, photos (the `avatar_file_id` column has no upload
feature), location. Redis holds only rate-limit counters and is not persisted.

## 2. Who can see what

Permissions per role are listed in [SECURITY.md](SECURITY.md#51-roles-and-key-permissions).

| Data | Who | Permission |
|---|---|---|
| Player list, search and detail (names, e-mail, phone, member number, consents, tags, Telegram username, history; detail adds country, language, date of birth) | Owner, Manager, TD, Floor manager, Registration staff, Cashier, Marketing manager, Read-only analyst | `player.read` |
| Staff notes / management notes | Owner, Manager, TD / Owner, Manager | `player.notes.read` / `staff.manage` |
| Edit player, record consent, set kiosk PIN | Owner, Manager, TD, Registration staff | `player.edit` |
| `players.csv` export | Owner, Manager, Marketing manager | `player.export` |
| CSV import | Owner, Manager | `player.import` + `player.create` |
| Anonymize | Owner, Manager | `player.edit` + `settings.manage` |
| Tournament snapshot (display names, nicknames, member numbers, check-in codes, entries, seats) | all staff roles; member numbers and check-in codes blanked without `registration.read` | `tournament.read` |
| Audit log | Owner, Manager, TD | `audit.read` |
| Staff list (e-mails, last login) | Owner, Manager | `staff.manage` |
| Devices (IP, user agent, current user) | Owner, Manager | `device.manage` |
| Notification queue (chat IDs, masked e-mails, payloads) | Owner, Manager | `telegram.manage` |
| Diagnostics (connected clients' IPs and user IDs) | Owner, Manager, TD, Floor manager, Read-only analyst | `edge.read` |
| Analytics (aggregates) | Owner, Manager, Marketing manager, Read-only analyst | `analytics.read` |
| Sync conflicts (payloads) | Owner, Manager | `sync.manage` |
| Own profile, registrations with check-in codes, inbox, history | the player | player session |

Player data is organization-wide: venue restrictions on staff accounts do not limit the CRM.

## 3. Lawful basis — notes for the operator

The product does not decide the legal basis; typical mappings to review with your adviser:

| Purpose | Data | Typical basis to consider |
|---|---|---|
| Accounts, registration, check-in, seating, results | identity, contact, competition history | contract / terms of participation |
| Leagues and public results | display names, positions, points | contract or legitimate interest; consent if your rules require it |
| Marketing messages | contact data | consent (`MARKETING`) |
| Security, fraud prevention, audit | IP, device, audit log, sessions | legitimate interest; possibly legal obligation |
| Buy-in bookkeeping | recorded amounts per entry | legal/accounting obligations |
| Telegram notifications | Telegram IDs, message content | the player's request (linking) |

152-FZ style considerations: written/explicit consent requirements for certain processing,
localisation of the primary database of Russian citizens' data (the edge server keeps it
on-premises; Telegram, cloud sync, SMTP and off-site backup providers may be located abroad),
cross-border transfer rules and regulator notification duties.

## 4. Consents and marketing

- Consent types: `PRIVACY_POLICY`, `MARKETING`, `PUBLIC_PROFILE`, `TELEGRAM_NOTIFICATIONS`.
  Every change is a **new row** in `player_consents` (history kept) with source and the recording staff
  member; the current state is mirrored in `players.marketing_consent` / `public_profile_enabled`.
- **Self sign-up** requires ticking "I accept the club's privacy policy" (recorded as `PRIVACY_POLICY`
  granted) and records `MARKETING` as chosen. **The product ships no privacy policy text** — the
  operator must provide and publish it.
- **Staff-created** players get a `MARKETING` consent row with the value from the form; staff can
  record any consent type on the player page (`CONSENT_RECORDED` audited).
- Players change "News and offers" (`MARKETING`) and "Public profile" (`PUBLIC_PROFILE`) on
  `/p/<org>/me`; each change is recorded and audited (`PROFILE_UPDATED_BY_PLAYER`).
- There is **no marketing campaign feature**. `marketing_consent` does not gate any automated message:
  notifications are service messages about the player's own registrations, seats and results, and
  announcements reach followers and registered players of that tournament. The `players.csv` export
  contains `marketing_consent` — filter on it before using addresses for marketing.
- `PUBLIC_PROFILE` and `TELEGRAM_NOTIFICATIONS` are recorded but not used by any public page or
  delivery rule in the current code.

## 5. Player self-service

| Action | Where |
|---|---|
| View own profile (name, e-mail), registrations, history and results | `/p/<org>/me` |
| Edit nickname, phone, notification language, marketing and public-profile choices | `/p/<org>/me` → Profile |
| Notification preferences per type and channel (in-app, Telegram, e-mail) | `/p/<org>/me`; Telegram channel also in the bot |
| Link / unlink Telegram | `/p/<org>/me` → Telegram (unlinking does not remove tournaments followed in the bot; unfollow there) |
| Cancel own registration | tournament page or bot |
| Kiosk one-time code | `/p/<org>/me` |

Not self-service: changing first/last name or e-mail, deleting the account, downloading own data.
The nickname does not change the public display name (only staff can edit the display name).
Requests for access, rectification or erasure are handled by staff (player page, export, anonymize).

## 6. Anonymization

`POST /api/v1/players/<id>/anonymize` (player page → Anonymize, with confirmation). It keeps
competition history consistent while removing identity from the player record
(`packages/core/src/services/player.service.ts`).

| Overwritten / removed | Kept |
|---|---|
| first name → `Anonymized`, last name → `Player`, display name → `Player <public ID>` | public ID, registrations, entries, transactions, seats, moves, results, league points |
| nickname, e-mail, phone, date of birth, member number, kiosk PIN, avatar reference → empty | language, country, tags, consent history, notification preferences, in-app notifications |
| marketing consent and public profile → off; status → `INACTIVE`; search text → public ID | Telegram link rows (revoked, but with Telegram user ID, chat ID, username) and followed tournaments |
| all staff notes deleted | the linked `users` account (e-mail, full name as display name, password — it can still sign in) |
| active Telegram links revoked | earlier audit entries (`PLAYER_CREATED`/`PLAYER_UPDATED` contain names, contacts, date of birth) |
| audit entry `PLAYER_ANONYMIZED`; outbox event `player.anonymized` (ID only, sent to the cloud when sync is on) | outbox payloads of earlier `player.created`/`player.updated` events; leaderboard snapshots with the old display name; sync conflicts; imported CSV files; backups |

Recommended follow-up (manual): recalculate affected league seasons
(`POST /api/v1/seasons/<id>/recalculate`, `league.manage`) so current standings show the anonymized
name; remove or neutralise the linked user account at database level if required; let backups
rotate out; ask the cloud operator to apply `player.anonymized`. There is no hard-delete of players.

## 7. Exports

| Export | Content | Permission | Controls |
|---|---|---|---|
| `GET /api/v1/exports/players.csv` | public ID, member number, first/last/display name, nickname, e-mail, phone, country, status, marketing consent, created | `player.export` | recorded in `export_jobs` (kind, row count, user) and audited as `DATA_EXPORTED`; file is not stored on the server |
| `GET /api/v1/tournaments/<id>/results.csv` | position, display name, public ID, entries, bounties, points, status, revision | `results.read` | audited as `DATA_EXPORTED` |

Exported files leave the system's controls; treat them as personal data.

## 8. Data shown publicly

"Public" means anyone who can reach the server (normally the venue network) without signing in.

| Where | What | Configurable |
|---|---|---|
| `/p/<org>` schedule, tournament pages | Published `PUBLIC` tournaments; `UNLISTED` by direct link; registration counts | visibility per tournament; `PRIVATE` never shown |
| Live page `/p/<org>/live/<slug>` | Clock, levels, statistics, announcements for `PLAYER_LIVE`/`DISPLAY`, **seat list** (display name, table, seat), **results** (position, display name); a signed-in player also sees own seat, status and check-in code | seat list: `publicSeatList` (default on); results always |
| Realtime events to anonymous viewers | Clock/status, eliminations and restores (display name, position, table/seat, eliminator), seat assignments/moves only with `publicSeatList`, results, leaderboard top 20 | as above |
| `/p/<org>/leaderboard` | Latest season of each active league: top 100 with rank, display name, points, tournaments, wins, internal player ID | not configurable |
| TV displays `/display/<token>` | Public snapshot; the seat list is always delivered to displays and shown during `SEATING` when the template has the `SEATING` widget; leaderboard and prize pool widgets | display template widgets; `prizeTracking` for prize pool |
| Kiosk | The checked-in player's display name and seat | — |
| Telegram bot (anyone who opens it) | Published `PUBLIC` schedule, running tournaments' statistics, league top 10 display names | — |

Display names default to the nickname or "First name + last initial" (e.g. `Anna K.`); staff can
set any display name. No e-mail, phone or member number is ever part of public data.

## 9. Data leaving the venue

| Recipient | What | When |
|---|---|---|
| Telegram (Bot API) | Message texts: tournament names, dates, venue, registration status and waitlist position, table/seat, positions and points, league rank, announcement texts, league top 10; staff alerts (backup errors, "Internet restored") and `/status` output to staff; the player's own registration list | Telegram enabled and account linked / chat started ([TELEGRAM.md](TELEGRAM.md)) |
| Telegram Mini App | The player's browser loads `telegram.org`'s script; Telegram supplies signed `initData`, which the server verifies without storing it. If the linked player has no account yet, a password-less account `telegram-<Telegram user ID>@players.invalid` is created | Mini App used |
| Cloud control plane (`CLOUD_API_URL`) | All syncable outbox events: player records created/updated **by staff** (ID, public ID, member number, names, display name, nickname, e-mail, phone, status, marketing consent, version), `player.anonymized`, tournament configuration and live events including display names, seats and results, announcements, leaderboard top 20 | only with `CLOUD_SYNC_ENABLED=true` + URL + token ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)) |
| SMTP server | Recipient e-mail, subject and text for `REGISTRATION_CONFIRMED`, `TOURNAMENT_CANCELLED`, `TOURNAMENT_CHANGED`, `RESULTS_FINALIZED` | `SMTP_HOST` set and player has e-mail |
| Off-site backup target | Complete database dumps | `OFFSITE_BACKUP_COMMAND` set |

Never sent to the cloud: passwords, PIN hashes, notes, consent history, date of birth, country,
language, audit log, sessions, devices, floor requests. Players created by self sign-up, changes
made by players themselves and CSV-import updates of existing players emit no sync event and
therefore are not sent.
WAN probes carry no personal data; `SENTRY_DSN` is not used by the code.

## 10. Retention and housekeeping

The worker runs housekeeping every 6 hours (`packages/core/src/runners/scheduler.ts`).

| Data | Retention in code |
|---|---|
| Sessions | deleted 7 days after expiry or revocation |
| Telegram link tokens/codes | deleted 1 day after expiry (15 min deep links, 10 min codes) |
| Telegram update receipts | 30 days |
| Notifications (+ Telegram delivery log) | deleted 90 days after creation once sent, expired, failed or cancelled |
| Outbox events | deleted after 30 days once synced or not syncable **and** processed by the notification fan-out; with cloud sync disabled, syncable events stay `PENDING` and are **never deleted** |
| Backups | newest `BACKUP_RETENTION` (default 28) dumps kept; with `BACKUP_SCHEDULE_HOURS=6` that is about 7 days |
| Audit log | indefinitely (append-only) |
| Players, history, consents, notes, leaderboard snapshots, devices, sync conflicts, one-time codes, import files and jobs | no automatic deletion |
| Container logs | Docker `json-file`, 5 × 20 MB per service |

## 11. Backups contain personal data

Every `pg_dump` contains the full database, including personal data, password hashes and the
encrypted bot token. Dumps are not encrypted by the application. Store them on an encrypted
volume, restrict access to the host, use an encrypting off-site tool (e.g. restic), and remember
that anonymization does not reach existing backups. See [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).

## 12. Operator checklist

1. Publish a privacy notice and link it where players sign up and at the desk.
2. Decide and document lawful bases (§3); keep consent records current when staff create players.
3. Choose public exposure: tournament visibility, `publicSeatList`, display names (encourage
   nicknames), display templates with seating/leaderboard widgets.
4. Grant `player.read`, `player.export` and `audit.read` only to roles that need them; review
   `/admin/staff` regularly.
5. Assess each outside recipient (Telegram, cloud operator, SMTP, off-site storage): processor
   agreements, location, transfer rules.
6. Handle data-subject requests: access (player page, export), rectification (edit), objection to
   marketing (consent toggle), erasure (anonymize + the manual follow-up in §6).
7. Set retention: backup count, off-site retention, and — if cloud sync is disabled — a manual cleanup
   of old outbox rows (they keep player payloads).
8. Protect the edge server and backups (disk encryption, physical access, `.env` permissions).
9. Prepare a breach response (regulator notification deadlines differ per law; e.g. GDPR 72 hours).
