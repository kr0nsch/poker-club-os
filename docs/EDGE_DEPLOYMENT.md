# Edge server deployment

How to install, configure, update and monitor the **Venue Edge Server**: one small Linux PC per venue
running the whole stack with Docker Compose. For the step-by-step venue checklist written for a
technician see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md); for the image/compose reference see
[DEPLOYMENT.md](DEPLOYMENT.md); for the network around the server see [LOCAL_NETWORK.md](LOCAL_NETWORK.md).

## What runs on the edge server

| Service (compose) | Role | Published |
| --- | --- | --- |
| `postgres` (`postgres:18-bookworm`) | The single source of truth, UTF-8 (`--encoding=UTF8 --locale=C.UTF-8`) | no |
| `redis` (`redis:8-alpine`) | Rate-limit counters only, no persistence (`--save ""`, `--appendonly no`) | no |
| `api` (target `api`) | REST API and local WebSocket on port 4000 | no |
| `worker` (target `worker`) | Clock ticker, WAN monitor, Telegram long polling, notification fan-out/delivery, cloud sync, reminders, backups, housekeeping | no |
| `web` (target `web`) | Next.js standalone server on port 3000 | no |
| `proxy` (`caddy:2`) | HTTPS reverse proxy, fixed IP `172.28.0.10` on the internal network | TCP 80, 443 |
| `minio` (profile `storage`, optional) | S3-compatible storage; not used by the application code ([DEPLOYMENT.md](DEPLOYMENT.md#optional-minio)) | no |

All services use `restart: unless-stopped`, so they come back after a crash or reboot once Docker
starts.

## Hardware

The stack is light (one venue, tens of devices), but the images are **built on the server** during
installation and updates, and the Next.js build needs memory. Recommendations (not benchmarks):

| Component | Minimum | Recommended |
| --- | --- | --- |
| Form factor | Mini-PC, x86-64 (amd64) | Fanless or quiet mini-PC, x86-64 |
| CPU | 4 cores (Intel N100 class) | 4–8 cores (Core i5 / Ryzen 5 class) |
| RAM | 8 GB | 16 GB |
| Storage | 128 GB SSD | 256–512 GB NVMe SSD; a model with power-loss protection if available |
| Network | 1 × Gigabit Ethernet (wired) | same; a second NIC is not needed |
| Firmware | "Restore on AC power loss: **Power On**" in BIOS/UEFI; working RTC battery | same |

Other architectures (arm64) may work with the multi-arch base images but are not tested. The health
check reports the disk as `DEGRADED` below 2 GB free.

## Operating system

Use **Ubuntu Server LTS** (24.04 or newer), minimal install with OpenSSH.

1. Update: `sudo apt-get update && sudo apt-get upgrade -y`.
2. Host name (becomes part of `EDGE_NODE_ID` when the install script creates `.env`):
   `sudo hostnamectl set-hostname poker`.
3. Time: `sudo timedatectl set-timezone <Region/City>` and check `timedatectl` shows
   *NTP service: active*. The tournament clock is derived from the server's wall clock.
4. Docker Engine with the Compose v2 plugin and BuildKit/buildx (the Dockerfile uses
   `RUN --mount=type=cache`):
   - Ubuntu packages: `sudo apt-get install -y docker.io docker-compose-v2 docker-buildx`, or
   - Docker CE from Docker's repository (`docker-ce`, `docker-buildx-plugin`, `docker-compose-plugin`).
5. Let the admin user run Docker: `sudo usermod -aG docker $USER`, then log out and in again
   (membership of the `docker` group is equivalent to root; keep the account private).
6. Firewall and SSH hardening: [NETWORK_SECURITY.md](NETWORK_SECURITY.md).

## Installation

Copy this repository (a release checkout) to the server, for example `/opt/pcos`, then:

```bash
cd /opt/pcos
./deploy/scripts/install-edge.sh poker.myclub.example
```

What [deploy/scripts/install-edge.sh](../deploy/scripts/install-edge.sh) does:

1. Checks that `docker` and `docker compose` (v2) are available.
2. If `.env` does not exist: copies `.env.example`, generates `SESSION_SECRET` (32 random bytes, hex)
   and `POSTGRES_PASSWORD` (24 random bytes, hex), sets `EDGE_NODE_ID=edge-<short host name>` and, when
   a host name argument is given, `LOCAL_HOSTNAME`, `LOCAL_APP_URL=https://<name>` and
   `ALLOWED_ORIGINS=https://<name>`. Sets `chmod 600 .env`. An existing `.env` is never touched.
3. Enables Docker at boot (`sudo systemctl enable --now docker`).
4. Builds and starts everything: `docker compose up -d --build` (needs the Internet: Docker Hub, the
   npm registry and apt.postgresql.org).
5. Waits up to about two minutes for `GET /health/ready` inside the `api` container.
6. Prints the **FIRST-RUN SETUP** block from the API log and the command to export Caddy's root
   certificate.

Without a host name argument `LOCAL_HOSTNAME` keeps the example value from `.env.example`; edit `.env`
and run `docker compose up -d`.

Manual alternative: `cp .env.example .env`, fill in at least `POSTGRES_PASSWORD`, `SESSION_SECRET`
(`openssl rand -hex 32`), `LOCAL_HOSTNAME`, `LOCAL_APP_URL`, `ALLOWED_ORIGINS`, `EDGE_NODE_ID`,
`chmod 600 .env`, then `docker compose up -d --build`. Use only letters and digits in
`POSTGRES_PASSWORD`: compose embeds it in `DATABASE_URL`.

### First-run setup token

While no user exists, the API requires a one-time setup token for `/setup`:

- With `SETUP_TOKEN` unset, the API generates a token on its **first** start and prints it once:

  ```bash
  docker compose logs api | grep -A4 "FIRST-RUN SETUP"
  ```

- Only a hash is stored, so later starts do not print it again. If the log is gone (for example the
  container was recreated), set your own `SETUP_TOKEN=<at least 16 characters>` in `.env`, run
  `docker compose up -d api`, use that value, and remove it from `.env` after setup.
- Wrong tokens are rate-limited per client IP. Once the owner account exists the setup endpoint is
  closed for good.

Open `https://<LOCAL_HOSTNAME>/` from a device on the venue network; it redirects to `/setup`. The
wizard asks for the token, club name and slug, venue name, time zone, **local host name** (use the same
value as `LOCAL_HOSTNAME`), edge server name and the owner account (password at least 10 characters),
then opens **Admin → Local network** with a first-run checklist.

## Environment variables

`.env` is read by Docker Compose (variable substitution) and passed to the `api`, `worker` and `web`
containers (`env_file`). The schema with defaults is [packages/core/src/config.ts](../packages/core/src/config.ts).
Compose **overrides** some values for the containers: `DATABASE_URL`, `REDIS_URL`, `STORAGE_DIR`,
`BACKUP_DIR` (api, worker), `TRUST_PROXY` (api), `PG_DUMP_PATH` (worker).

### Compose and proxy

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_DB` | `pcos` / `pcos` | Database role and name; used to build `DATABASE_URL` |
| `POSTGRES_PASSWORD` | – (**required**) | Database password; compose refuses to start without it |
| `LOCAL_HOSTNAME` | `poker.local` in compose; `poker.club.example` in `.env.example` | Also Caddy's `SITE_ADDRESS` (comma-separated list allowed, see [LOCAL_NETWORK.md](LOCAL_NETWORK.md#8-ip-fallback-url)) |
| `CADDY_TLS` | `internal` | `internal`, `/certs/fullchain.pem /certs/privkey.pem`, or an e-mail address for ACME |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Host ports of the proxy |
| `PCOS_VERSION` | `latest` | Tag of the locally built images `pcos/api`, `pcos/worker`, `pcos/web` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `pcos` / `change-me-please` (compose) | MinIO root credentials when the `storage` profile runs |

`API_UPSTREAM` / `WEB_UPSTREAM` (Caddyfile, defaults `api:4000` / `web:3000`) only matter when Caddy
runs outside compose.

### Core

| Variable | Default (config.ts) | `.env.example` | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | Runtime mode |
| `DATABASE_URL` | – (**required**) | example URL | PostgreSQL URL (set by compose) |
| `REDIS_URL` | unset | `redis://redis:6379` | Optional Redis; empty = in-process rate limiting |
| `APP_URL` | unset | empty | Public Internet URL for Telegram buttons and e-mails |
| `LOCAL_APP_URL` | unset | `https://poker.club.example` | Venue-local URL; fallback for QR codes and the venue's local URL at setup |
| `ALLOWED_ORIGINS` | empty list | `https://poker.club.example` | Extra browser origins accepted by the Origin/CSRF checks (comma separated); the request's own host is always accepted |
| `PORT` | `4000` | `4000` | API listen port (compose routes to `api:4000`) |
| `TRUST_PROXY` | `loopback` | `loopback,172.16.0.0/12` | Who may set `X-Forwarded-For`; compose sets `loopback,172.28.0.0/24` |
| `AUTO_MIGRATE` | `true` | `true` | Apply migrations and seed system roles on API/worker start |
| `EDGE_NODE_ID` | `edge-dev` | `edge-main-01` | Stable identity of this edge node (keep it when replacing hardware) |
| `VENUE_ID` | unset | empty | Venue this node registers for; default = first venue |
| `SESSION_SECRET` | – (**required**, ≥ 32 chars) | empty | Secret material; also the default key source for encrypted integration secrets |
| `SECRETS_ENCRYPTION_KEY` | derived from `SESSION_SECRET` | empty | Key for integration secrets at rest (e.g. the Telegram bot token saved in the admin UI) |
| `SESSION_TTL_HOURS` | `336` (14 days, max 2160) | `336` | Absolute lifetime of a sign-in session |
| `COOKIE_SECURE` | `true` | `true` | `Secure` flag on the session cookie (keep `true` behind HTTPS) |
| `SETUP_TOKEN` | generated | empty | Fixed first-run setup token |

### Telegram, cloud sync, WAN probe

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_ENABLED` | `false` | Enable the bot configured by environment |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | unset | Bot credentials from the environment; a token saved in **Admin → Telegram** takes precedence for the club |
| `TELEGRAM_MODE` | `long_polling` | `long_polling` (edge polls, no inbound port) or `webhook` (cloud gateway mode) |
| `TELEGRAM_WEBHOOK_SECRET` | unset | Secret expected on webhook calls |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Bot API base URL (not in `.env.example`; tests point it to a mock) |
| `CLOUD_SYNC_ENABLED` / `CLOUD_API_URL` / `CLOUD_SYNC_TOKEN` | `false` / unset / unset | Optional cloud sync; all three are needed ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)) |
| `WAN_PROBE_URLS` | `https://api.telegram.org,https://1.1.1.1` | Any HTTP response from any URL = Internet available |
| `WAN_PROBE_INTERVAL_MS` | `15000` | Probe interval (min 200) |

Telegram setup and modes: [TELEGRAM.md](TELEGRAM.md).

### Storage, backups, e-mail, misc

| Variable | Default (config.ts) | `.env.example` | Purpose |
| --- | --- | --- | --- |
| `STORAGE_DIR` | `./data/files` | `/data/files` | Uploaded files (CSV imports); compose: `/data/files` in the `edgedata` volume |
| `BACKUP_DIR` | `./data/backups` | `/data/backups` | Database dumps; compose: `/data/backups` in `edgedata` |
| `BACKUP_SCHEDULE_HOURS` | `6` | `6` | Hours between automatic backups; `0` disables the schedule |
| `BACKUP_RETENTION` | `28` | `28` | Number of dump files kept |
| `PG_DUMP_PATH` | `pg_dump` | `pg_dump` | pg_dump binary; compose worker: `/usr/bin/pg_dump` (PostgreSQL 18 client) |
| `OFFSITE_BACKUP_COMMAND` | unset | empty | Command run after each backup, `{file}` = dump path ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md#off-site-copies)) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | unset / 587 when unset | empty / `587` | E-mail transport; enabled only when `SMTP_HOST` is set; port 465 uses implicit TLS |
| `SMTP_FROM` | `Poker Club <no-reply@localhost>` | `Poker Club <no-reply@club.example>` | Sender |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | unset | empty | Parsed but not used by the application (no S3 adapter yet) |
| `SENTRY_DSN` | unset | empty | Parsed but not used |
| `LOG_LEVEL` | `info` | `info` | Parsed but not used by the current console logging |
| `SOFTWARE_VERSION` | `0.1.0` | – | Version reported for the edge node and diagnostics (not derived from `PCOS_VERSION`) |

Advanced loop intervals (not in `.env.example`; tests shorten them): `FANOUT_INTERVAL_MS` (1000),
`DISPATCH_INTERVAL_MS` (2000), `SYNC_PUSH_INTERVAL_MS` (10000), `SYNC_PULL_INTERVAL_MS` (60000),
`TELEGRAM_POLL_TIMEOUT_S` (25, 1–50).

After editing `.env`, run `docker compose up -d`; compose recreates the containers whose configuration
changed (`docker compose restart` does **not** reload `.env`). The diagnostics bundle on
**Admin → Health & backups** shows the effective configuration with secrets replaced by `<set>`/`<unset>`.

## Updating to a new version

Update between sessions if possible. A running tournament survives the restart (the clock is an
anchor in PostgreSQL, devices reconnect), but screens show "Reconnecting…" for a short while.

1. Back up: **Admin → Health & backups → Run backup now**, or `./deploy/scripts/backup.sh` (writes
   `backups/pcos-<timestamp>.dump` on the host).
2. Put the new release into the same directory, keeping `.env`. Compare `.env.example` with `.env`
   for new variables.
3. Set `PCOS_VERSION=<new version>` in `.env` so the previous images stay available under their tag.
4. Build: `docker compose build`.
5. Start: `docker compose up -d`. With `AUTO_MIGRATE=true` the API and the worker apply pending
   migrations at start (serialized by a PostgreSQL advisory lock).
6. Verify: `docker compose ps` (all healthy), `docker compose logs --since 10m api worker`,
   **Admin → Health & backups** shows `OK` or only expected `DEGRADED` items.

Rollback: set `PCOS_VERSION` back and run `docker compose up -d` (uses the existing images). Migrations
are forward-only; if the new version changed the schema, restore the backup from step 1
([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md#restore-procedure)) — changes made after it are lost.

## Logs

```bash
docker compose logs -f api worker          # follow API and worker
docker compose logs --since 1h web proxy   # last hour of web and Caddy
docker compose logs api | grep "FIRST-RUN SETUP" -A4
```

- API and worker log to stdout with prefixes such as `[api]`, `[worker]`, `[wan]`, `[telegram]`,
  `[clock]`, `[ws]`. The WAN monitor logs `Internet available` / `Internet UNAVAILABLE — local operations continue`.
- Caddy logs only warnings and errors.
- `api`, `worker` and `web` use the `json-file` driver with rotation (20 MB × 5 files). `postgres`,
  `redis` and `proxy` use the Docker daemon default.
- Logs never contain the bot token or other secrets by design ([SECURITY.md](SECURITY.md)).

## Health checks

| Check | Access | Meaning |
| --- | --- | --- |
| `docker compose ps` | server shell | `postgres`, `redis` (compose) and `api`, `web` (image HEALTHCHECK) report `healthy` |
| `GET /health/live` | public | Process is up: `{"status":"ok"}` |
| `GET /health/ready` | public | `200 ready` when PostgreSQL answers, else `503` |
| `GET /health` | public | Overall `status` (`OK`, `DEGRADED` or `DOWN`), `components[]` (name, state), `time`; HTTP 503 only when PostgreSQL is down |
| `GET /api/v1/edge/status` | public | Edge/WAN/Telegram/cloud-sync state as pushed to devices |
| `GET /api/v1/edge/health`, `/api/v1/edge/diagnostics` | staff with `edge.read` | Component details; diagnostics bundle without secrets |
| **Admin → Health & backups** | staff | The same, plus backups, cloud sync and conflicts |

Components: `postgres`, `redis` (`DISABLED` when not configured), `websocket`, `disk`, `backup`
(`DEGRADED` without a successful backup within max(24 h, 2 × `BACKUP_SCHEDULE_HOURS`) or when the
last run failed), `wan`, `telegram`, `cloud_sync`. A missing Internet connection is `DEGRADED`, never
`DOWN` ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)).

From the server shell:

```bash
docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.text()).then(console.log)"
curl --resolve poker.myclub.example:443:127.0.0.1 --cacert pcos-local-root.crt https://poker.myclub.example/health
```

## Power and UPS

- Put the edge server, router, switch(es) and access points on a UPS (line-interactive or online,
  10–15 minutes of runtime is enough to ride through short outages). Without network power, tablets
  lose the server even if the server itself keeps running.
- The system tolerates a hard power cut: committed data is durable in PostgreSQL, Docker restarts the
  containers, the tournament clock continues from its anchor, devices reconnect by themselves
  ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md#edge-server-power-loss)).
- Set the BIOS/UEFI to power on after AC loss so the server comes back without a person present.
- Graceful shutdown on low UPS battery (for example Network UPS Tools over USB) is optional and not
  configured by this repository.

## Everyday commands

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Start / apply `.env` changes | `docker compose up -d` |
| Restart one service | `docker compose restart api` |
| Stop everything | `docker compose stop` |
| Database shell | `docker compose exec postgres psql -U pcos pcos` |
| List automatic backups | `docker compose exec worker ls -l /data/backups` |
| Manual backup to `./backups` | `./deploy/scripts/backup.sh` |
| Export the local root certificate | `docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./pcos-local-root.crt` |

Never run `docker compose down -v`: it deletes the database, backups and Caddy CA volumes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `docker compose up` fails with "set POSTGRES_PASSWORD in .env" | `.env` missing or the password empty |
| API restarts in a loop with "Invalid configuration" | `docker compose logs api`; usually `SESSION_SECRET` shorter than 32 characters or a malformed URL variable |
| API log: "database encoding is …; Poker Club OS requires UTF8" | The database was not created as UTF-8; recreate it (compose always initializes UTF-8) |
| `proxy` does not start | It waits for `web` and `api` to be healthy: `docker compose ps`, then the logs of the unhealthy service |
| Browser certificate error | Root certificate not trusted on the device, or the host name differs from `LOCAL_HOSTNAME` ([LOCAL_NETWORK.md](LOCAL_NETWORK.md#4-https-on-the-lan)) |
| `/setup` rejects the token | Token copied with spaces or from an old log; set `SETUP_TOKEN` as described above |
| Health `backup` is `DEGRADED` | **Admin → Health & backups → Backups** shows the error ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)) |
| Health `wan` is `DEGRADED` | Expected without Internet; otherwise check the router and that the probe URLs are reachable |
