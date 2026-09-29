# Deployment reference

Reference for the deployment artifacts in this repository: the Docker images, the compose stack, the
Caddy reverse proxy, TLS options, migrations, optional components, and the development and test
setup. The operational procedure for a venue is in [EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md) and
[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md); the system design is in [ARCHITECTURE.md](ARCHITECTURE.md).

| Artifact | Purpose |
| --- | --- |
| [Dockerfile](../Dockerfile) | One multi-stage build, three runtime targets: `api`, `worker`, `web` |
| [docker-compose.yml](../docker-compose.yml) | The complete edge stack (project name `pcos`) |
| [deploy/caddy/Caddyfile](../deploy/caddy/Caddyfile) | Reverse proxy, TLS, routing |
| [deploy/scripts/install-edge.sh](../deploy/scripts/install-edge.sh) | First installation on Ubuntu/Debian |
| [deploy/scripts/backup.sh](../deploy/scripts/backup.sh), [restore.sh](../deploy/scripts/restore.sh) | Manual dump / restore ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)) |
| [.env.example](../.env.example) | All configuration variables ([EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md#environment-variables)) |

## Images and targets

All images are built locally from the repository (`docker compose build`); nothing is pulled from a
private registry. Base image: `node:24-bookworm-slim` (`NODE_VERSION` build argument), pnpm 12.4.1 via
corepack, telemetry disabled.

| Stage / target | Contents | Port | Healthcheck | Command |
| --- | --- | --- | --- | --- |
| `build` | `pnpm fetch` + offline install with the lockfile, `turbo run build` for `@pcos/api`, `@pcos/worker`, `@pcos/web`, then `pnpm deploy --prod` of API and worker | – | – | – |
| `runtime` | `NODE_ENV=production`, `/data/files` and `/data/backups` owned by `node` | – | – | – |
| `api` | `/out/api` (API + workspace packages + production dependencies) | 4000 | `GET http://127.0.0.1:4000/health/live` every 10 s | `node dist/main.js` |
| `worker` | `/out/worker` plus `postgresql-client-18` from apt.postgresql.org (pg_dump must match the server) | – | – | `node dist/main.js` |
| `web` | Next.js standalone output, static assets, `public/` (`sw.js`, `icon.svg`) | 3000 | `GET http://127.0.0.1:3000/login` every 15 s | `node apps/web/server.js` |

All runtime containers run as the unprivileged `node` user. The `web` build argument `API_ORIGIN`
(compose: `http://api:4000`) is only a server-side fallback for `/api` rewrites; in production Caddy
routes `/api` directly to the API.

## Compose services

| Service | Image | Depends on | Volumes | Notes |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:18-bookworm` | – | `pgdata:/var/lib/postgresql` | `POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8`, `shm_size: 256mb`, `stop_grace_period: 60s`, `pg_isready` healthcheck |
| `redis` | `redis:8-alpine` | – | – | No persistence, `maxmemory 256mb`, `allkeys-lru`, `redis-cli ping` healthcheck |
| `api` | `pcos/api:${PCOS_VERSION}` | postgres, redis healthy | `edgedata:/data` | Sets `DATABASE_URL`, `REDIS_URL`, `TRUST_PROXY=loopback,172.28.0.0/24`, `STORAGE_DIR`, `BACKUP_DIR` |
| `worker` | `pcos/worker:${PCOS_VERSION}` | postgres, api healthy | `edgedata:/data` | Sets `DATABASE_URL`, `REDIS_URL`, `STORAGE_DIR`, `BACKUP_DIR`, `PG_DUMP_PATH=/usr/bin/pg_dump` |
| `web` | `pcos/web:${PCOS_VERSION}` | api healthy | – | Build arg `API_ORIGIN=http://api:4000` |
| `proxy` | `caddy:2` | web, api healthy | Caddyfile (ro), `./deploy/certs:/certs` (ro), `caddy_data`, `caddy_config` | Publishes `${HTTP_PORT:-80}:80`, `${HTTPS_PORT:-443}:443`; `SITE_ADDRESS=${LOCAL_HOSTNAME:-poker.local}`, `CADDY_TLS=${CADDY_TLS:-internal}`; fixed IP `172.28.0.10` |
| `minio` | `minio/minio:latest` | – | `minio:/data` | Profile `storage` only; see [Optional MinIO](#optional-minio) |

`api`, `worker` and `web` share the `x-app` settings: `restart: unless-stopped`, `env_file: .env`, network
`edge`, `json-file` logging with 20 MB × 5 rotation. `environment:` entries in compose take precedence
over the same variables in `.env`.

### Network and volumes

- Network `edge`: bridge, subnet `172.28.0.0/24`. The proxy's fixed address is what `TRUST_PROXY`
  refers to: only Caddy may set `X-Forwarded-For`.
- Only the proxy publishes ports. PostgreSQL, Redis, the API, the web server and MinIO are reachable
  only inside `edge`.

| Volume | Contents | Back up? |
| --- | --- | --- |
| `pgdata` | PostgreSQL cluster | Through dumps, not by copying the volume while running |
| `edgedata` | `/data/backups` (automatic dumps), `/data/files` (uploaded CSV imports) | Copy the dumps off the server ([BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)) |
| `caddy_data` | Caddy's local CA and certificates | Yes, the CA directory (otherwise devices must re-trust a new root) |
| `caddy_config` | Caddy autosave config | No |
| `minio` | MinIO objects | Only if you use MinIO |

## Caddy configuration

[deploy/caddy/Caddyfile](../deploy/caddy/Caddyfile):

| Request | Upstream | Details |
| --- | --- | --- |
| `/api/*`, `/health`, `/health/*` | `{$API_UPSTREAM:api:4000}` | REST API and health checks |
| `/ws` | `{$API_UPSTREAM:api:4000}` | WebSocket, `flush_interval -1` |
| everything else | `{$WEB_UPSTREAM:web:3000}` | Staff, player, display and kiosk UI |

- Site address `{$SITE_ADDRESS:poker.local}` (compose: `LOCAL_HOSTNAME`); a comma-separated list
  serves several names or an IP address.
- `tls {$CADDY_TLS:internal}`; plain HTTP is redirected to HTTPS.
- Response headers: `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`,
  `Server` removed. The API and web app add their own security headers (CSP, frame options, no-store
  on `/api/`) — see [SECURITY.md](SECURITY.md).
- `zstd`/`gzip` compression, server idle timeout 5 minutes for long-lived WebSockets.
- Admin API bound to `localhost:2019` inside the container; logs at level `WARN` to stdout.
- `API_UPSTREAM` / `WEB_UPSTREAM` let the same file run outside compose (for example Caddy on a host
  in front of `127.0.0.1:4000` and `127.0.0.1:3000`).

## TLS options

| Mode | `CADDY_TLS` | Requirements | Renewal | Devices |
| --- | --- | --- | --- | --- |
| Internal CA (default) | `internal` | None; works fully offline | Automatic, offline | Must trust Caddy's root certificate ([DEVICE_SETUP.md](DEVICE_SETUP.md#trusting-the-local-certificate)) |
| Own certificate | `/certs/fullchain.pem /certs/privkey.pem` | A certificate for the host name, files in `deploy/certs/` (mounted read-only at `/certs`) | Manual: replace the files, `docker compose restart proxy` | Nothing to install if the certificate is publicly trusted |
| ACME | an e-mail address, e.g. `ops@myclub.example` | Host name in public DNS pointing to an address where the edge server is reachable from the Internet on port 80 or 443 | Automatic while online | Nothing to install |

ACME conflicts with the local-first goal: it needs inbound reachability from the Internet (see
[NETWORK_SECURITY.md](NETWORK_SECURITY.md)) and renewals fail during long WAN outages. A certificate
obtained elsewhere (for example with a DNS challenge on another machine) and installed as files avoids
inbound exposure, at the cost of manual renewal. `.gitignore` excludes `*.pem` and `*.key`.

## Scaling

- **One edge node per venue.** The compose file runs one `api` and one `worker`; this is the supported
  topology. A club with several venues runs one edge server in each; they share nothing locally. The
  optional cloud control plane is not part of this repository ([EDGE_CLOUD_SYNC.md](EDGE_CLOUD_SYNC.md)).
- Concurrency safety does not depend on a single process: migrations take a PostgreSQL advisory lock,
  Telegram long polling takes an advisory lock per bot, notification rows are claimed with
  `FOR UPDATE SKIP LOCKED`, backup runs are claimed by a conditional update, and realtime events fan out
  through PostgreSQL `LISTEN/NOTIFY` to every API process ([REALTIME.md](REALTIME.md)).
- Load per venue is small (tens of devices, 64 WebSocket connections per client IP at most). Scale
  vertically (CPU, SSD) rather than horizontally.

## Migrations

- SQL migrations live in `packages/db/drizzle` and are applied by `runMigrations`
  ([packages/db/src/migrate.ts](../packages/db/src/migrate.ts)). The runner refuses to run unless the
  database encoding is `UTF8` and serializes concurrent runners with `pg_advisory_lock(727001)`.
- `AUTO_MIGRATE=true` (default): both the API and the worker apply pending migrations and seed the
  system roles on start. This is how updates migrate the database.
- `AUTO_MIGRATE=false`: run them explicitly before starting new versions:

  ```bash
  docker compose run --rm api node node_modules/@pcos/db/dist/cli.js migrate
  ```

  In development: `pnpm db:migrate` with `DATABASE_URL` set in the environment (the script does not
  read `.env`).
- Migrations are forward-only. Roll back by restoring a dump taken before the update.

## Running without Redis

Redis holds only rate-limit counters. With `REDIS_URL` empty the API uses an in-process limiter and the
health component `redis` reports `DISABLED`; if a configured Redis becomes unreachable the limiter
falls back to memory and the component reports `DEGRADED`. Nothing authoritative is ever stored in
Redis.

The shipped compose file always runs Redis: it sets `REDIS_URL=redis://redis:6379` for `api` and
`worker` (overriding `.env`) and makes `api` wait for Redis to be healthy. Running the compose stack
without Redis therefore requires editing `docker-compose.yml`; outside compose, leave `REDIS_URL` empty.

## Optional MinIO

`docker compose --profile storage up -d` additionally starts MinIO (`minio/minio:latest`, console on
`:9001`, data in the `minio` volume, root credentials `S3_ACCESS_KEY` / `S3_SECRET_KEY`). It is only
reachable inside the `edge` network.

The current application does **not** use it: files are stored by the local filesystem adapter in
`STORAGE_DIR`, and `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` are parsed but not read
by any service. MinIO on the same server is also not an off-site backup location.

## Running outside Docker

Not the supported production path. The Dockerfile documents what each process needs: the API and the
worker are `node dist/main.js` with the configuration in the environment, the web app is the Next.js
standalone server, and the worker needs a PostgreSQL 18 `pg_dump` (`PG_DUMP_PATH`). The same Caddyfile
can front such processes by setting `API_UPSTREAM` and `WEB_UPSTREAM`; this is how the proxy topology
was verified on the development workstation ([ASSUMPTIONS.md](ASSUMPTIONS.md#verification-limits)).

## Development setup

Requirements: Node.js ≥ 24 and pnpm 12 (`packageManager: pnpm@12.4.1`). On the reference Windows
workstation the toolchain is portable and lives in `.venv/` (not committed). Activate it in every
PowerShell session:

```powershell
. .\.venv\env.ps1
```

`.venv/env.ps1` prepends Node, Git, pnpm, Caddy, the Docker CLI and the PostgreSQL
client tools (`.venv/tools/pgsql/bin`: `pg_dump`, `pg_restore`, `psql`, …) to `PATH`, keeps the pnpm
store, npm/pnpm caches, Docker config and Caddy data inside `.venv`, and disables Next.js/Turborepo
telemetry. Linux production does not use `.venv`; it uses the Docker images.

```powershell
pnpm install
pnpm dev
```

`pnpm dev` ([scripts/dev.mjs](../scripts/dev.mjs)):

1. Creates `.env` from `.env.example` on first run with development values: `DATABASE_URL` for the
   embedded database, a random `SESSION_SECRET` and `SETUP_TOKEN`, `LOCAL_APP_URL` and `ALLOWED_ORIGINS`
   `http://localhost:3000`, `COOKIE_SECURE=false`, `EDGE_NODE_ID=edge-dev`, `NODE_ENV=development`, and
   absolute `STORAGE_DIR`/`BACKUP_DIR` under `.data/`.
2. Starts embedded PostgreSQL 18 ([scripts/dev-db.mjs](../scripts/dev-db.mjs)): data in `.data/postgres`,
   port `54320` (`DEV_DB_PORT`), database `pcos` (`DEV_DB_NAME`), cluster and database forced to UTF-8
   (the Windows code page would be used otherwise).
3. Builds the shared packages, API and worker with Turborepo.
4. Runs TypeScript watch builds, the API and the worker (`node --env-file=.env`, restarted on `dist`
   changes) and `next dev` on port 3000.

Other variables left as in the template matter in development: `REDIS_URL=redis://redis:6379` does not
resolve on a workstation (the health page shows `redis` as `DEGRADED`; set `REDIS_URL=` to run without
Redis), and backups use `PG_DUMP_PATH=pg_dump` from the activated `.venv`.

| URL | What |
| --- | --- |
| http://localhost:3000 | Web app (first visit redirects to `/setup`) |
| http://localhost:4000 | API (`/health`, `/api/v1/...`, `/ws`) |

The web dev server does not proxy WebSockets; [apps/web/.env.development](../apps/web/.env.development)
sets `NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws` and `API_ORIGIN=http://127.0.0.1:4000`.

Demo data through the real API (second terminal, `.venv` activated):

```powershell
pnpm seed:demo
```

[scripts/seed-demo.mjs](../scripts/seed-demo.mjs) completes the first-run setup with `SETUP_TOKEN` if
needed, then creates staff accounts, 28 players, a league and season, a running tournament, one with
open registration, one scheduled, and a display and a kiosk link (their paths are printed). Options:
`--api <url>` or `SEED_API_URL`, `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, `--force` to seed again.
Development sign-in: `td@royal.example` / `correct-horse-battery`.

Other scripts: `pnpm dev:db` (database only), `pnpm build`, `pnpm db:generate` (drizzle-kit),
`pnpm format`, `pnpm clean`.

## Tests

| Command | Runs |
| --- | --- |
| `pnpm typecheck` | TypeScript checks (`tsc --noEmit`) in the packages that define `typecheck` |
| `pnpm lint` | ESLint in the packages that define `lint` |
| `pnpm test` | Vitest in `@pcos/domain`, `@pcos/telegram` and `@pcos/core` (core tests run against embedded PostgreSQL) |
| `pnpm test:e2e` | `tests/e2e`: real API and worker processes against embedded PostgreSQL |

Turborepo builds the dependencies first (`dependsOn: ["^build"]`). The end-to-end suite
([tests/e2e](../tests/e2e)) starts one embedded PostgreSQL cluster in `.data/test-pg-<n>`, migrates a
template database, clones it per test file, and spawns the built API and worker with local stand-ins
for the Telegram Bot API, the cloud endpoint and the WAN probe that can be switched off. Files run
sequentially:

| File | Proves |
| --- | --- |
| `lan.test.ts` | Local operation: concurrent floor managers, version conflicts, idempotent retries, undo, CSRF and origin checks, realtime delivery to staff/public/display sockets |
| `wan-recovery.test.ts` | Internet outage during a live tournament ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)) |
| `restart.test.ts` | Hard crash (`SIGKILL`) of API and worker mid-tournament and recovery |
| `telegram.test.ts` | Account linking, registration through the bot, redelivered updates, disabled staff commands ([TELEGRAM.md](TELEGRAM.md)) |

Known verification limits (for example that the Docker images were not built on the development
workstation) are listed in [ASSUMPTIONS.md](ASSUMPTIONS.md#verification-limits).
