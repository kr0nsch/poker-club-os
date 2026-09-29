# Backup and recovery

The edge server's PostgreSQL database is the single source of truth for the venue: players,
tournaments, seats, clocks, results, leagues, the audit log and the outbox of events not yet sent to
the cloud. Backing it up regularly — and keeping a copy away from the edge server — is the one
operational duty that protects the club from a dead disk or a stolen mini-PC.

Code: `packages/core/src/services/backup.service.ts`, `deploy/scripts/backup.sh`,
`deploy/scripts/restore.sh`, configuration in `.env` / `packages/core/src/config.ts`.

## What is backed up

| Data | Where | Backed up by |
| --- | --- | --- |
| Database (everything above) | PostgreSQL volume `pgdata` | Automatic and manual `pg_dump` backups |
| Uploaded files (CSV imports) | `edgedata` volume, `/data/files` | Not by the database backup — copy the volume if imports must be kept |
| Configuration and secrets | `.env` next to `docker-compose.yml` | **You** — keep an encrypted copy (see below) |
| Caddy's local certificate authority | `caddy_data` volume | Optional; without it Caddy creates a new CA and devices must trust it again |

Why `.env` matters: the Telegram bot token is stored encrypted with a key derived from
`SECRETS_ENCRYPTION_KEY` (or, when unset, from `SESSION_SECRET`). A database restored on a server with
different secrets works normally, but the stored bot token cannot be decrypted: re-enter it in
**Admin → Telegram**. Sessions are random tokens stored as hashes, so they survive a restore on the same
database regardless of `.env`.

## Automatic backups

The worker runs `pg_dump --format=custom --no-owner --no-privileges` every
`BACKUP_SCHEDULE_HOURS` hours (default **6**; `0` disables the schedule) and writes
`pcos-<UTC timestamp>.dump` into `BACKUP_DIR` (`/data/backups` in the containers, i.e. the `edgedata`
volume). Only the newest `BACKUP_RETENTION` files are kept (default **28**, one week at 6-hour
intervals).

- Credentials reach `pg_dump` through the environment, never the command line.
- A run is recorded in `backup_runs` (status, size, duration, error) and shown in
  **Admin → Health & backups**; **Run backup now** queues a manual run (`POST /api/v1/edge/backups`,
  permission `backup.manage`). Only one run is queued or running at a time.
- A failed run raises a `CRITICAL` staff alert ("Backup failed") to the Telegram staff chat when one is
  configured, and the health page marks backups as failing.
- The backup is taken from the live database without stopping anything; `pg_dump` sees a consistent
  snapshot, so it is safe during a running tournament.

### Off-site copy

Set `OFFSITE_BACKUP_COMMAND` to a command that receives the new file as `{file}`; it runs after each
successful backup and its result is stored with the run (`COPIED` or `FAILED: …`). Examples:

```bash
# restic to S3-compatible storage (repository password via RESTIC_PASSWORD_FILE in the container)
OFFSITE_BACKUP_COMMAND=restic -r s3:https://s3.example.com/pcos-backups backup {file}
# rclone to any configured remote
OFFSITE_BACKUP_COMMAND=rclone copy {file} club-backups:pcos
```

The command is split on spaces (no shell), so wrap complex logic in a script mounted into the worker
container. Off-site copies need the Internet; when it is down the copy fails and the next backup
tries again — the local file is always written first. Encrypt off-site copies: backups contain
personal data (see [PRIVACY.md](PRIVACY.md)).

## Manual backup

```bash
./deploy/scripts/backup.sh
```

Writes `backups/pcos-YYYYMMDD-HHMMSS.dump` next to `docker-compose.yml` using `pg_dump` inside the
`postgres` container. Use it before upgrades or before risky maintenance. To copy the automatic
backups out of the volume:

```bash
docker compose cp worker:/data/backups ./backups
```

## Restore

```bash
./deploy/scripts/restore.sh backups/pcos-20260928-203000.dump
```

The script asks you to type `RESTORE`, stops `api`, `worker` and `web`, drops and recreates the
database as UTF-8 from `template0`, runs `pg_restore --no-owner --exit-on-error`, and starts the
services again. Tournament clocks resume from their persisted anchor: a clock that was running keeps
counting from the backup's point in time, so check the clock on the floor console right after a
restore and adjust it if needed.

What is **not** rewound by a restore: messages already delivered to Telegram, events already
accepted by the cloud, and anything printed. Events that were still pending at backup time are sent
again after the restore; the cloud de-duplicates them by `eventId`.

### Verification checklist after a restore

1. `docker compose ps` — all services `healthy`; `https://<hostname>/health/ready` returns `ready`.
2. Sign in as an administrator; **Admin → Health & backups** shows no failing component except, if
   applicable, the Internet.
3. Open the running tournament in the floor console: players, seats, stacks and the clock match the
   expected state.
4. **Admin → Audit log** shows entries up to the time of the backup.
5. Take a new manual backup so the restored state is itself backed up.

A restore of a development backup into an empty UTF-8 database was verified: identical row counts,
the audit log's append-only trigger and the migration history were all restored.

## Recovery scenarios

| Situation | What to do |
| --- | --- |
| Power loss or crash during a tournament | Nothing: PostgreSQL recovers on start, the clock continues from its anchor, clients reconnect and resynchronise, commands retried by tablets are applied once. See [OFFLINE_OPERATION.md](OFFLINE_OPERATION.md) |
| Wrong action on the floor (wrong player eliminated, wrong move) | Undo it in the floor console (history → Undo); the audit log shows who did what from which device. No restore needed |
| Configuration mistake (structure, template, settings) | Correct it in the admin; the audit log keeps the previous values |
| Disk failure or stolen/broken edge server | Install a new edge server ([INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)), restore `.env` from your secure copy, start the stack, then run `restore.sh` with the newest off-site backup. Devices keep working once the hostname points to the new server; re-trust the Caddy CA if its volume was lost |
| Corrupted database | Restore the newest good backup; operations after that backup must be re-entered (the audit log of the broken server, if readable, tells what) |

## Recommended routine

- Keep the default 6-hour schedule and configure an off-site copy.
- Take a manual backup before every software update.
- Once a month, restore the latest backup into a scratch database (or a spare machine) and run the
  verification checklist — a backup that was never restored is not a backup.
- Keep `.env` in the club's password manager or an encrypted store, separate from the backups.
