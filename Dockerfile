# syntax=docker/dockerfile:1.7
# Venue Edge Server images (one Dockerfile, three targets): api, worker, web.
#   docker compose build          (uses the targets below)

ARG NODE_VERSION=24

# --- toolchain -------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /repo

# --- build everything once -------------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pcos-pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pcos-pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
# Server-side fallback route for /api (the reverse proxy normally routes /api to the API directly).
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=${API_ORIGIN}
RUN pnpm turbo run build --filter=@pcos/api --filter=@pcos/worker --filter=@pcos/web
# Self-contained production folders (workspace packages + prod dependencies only).
RUN --mount=type=cache,id=pcos-pnpm-store,target=/pnpm/store \
    pnpm --filter=@pcos/api deploy --prod /out/api && \
    pnpm --filter=@pcos/worker deploy --prod /out/worker

# --- common runtime ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    STORAGE_DIR=/data/files \
    BACKUP_DIR=/data/backups
RUN mkdir -p /data/files /data/backups && chown -R node:node /data
WORKDIR /app

# --- API: REST + local WebSocket ---------------------------------------------------------------
FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# --- worker: clock ticker, notifications, Telegram polling, sync, backups ---------------------
FROM runtime AS worker
# pg_dump must match the PostgreSQL 18 server for backups.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-18 && \
    apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out/worker /app
USER node
CMD ["node", "dist/main.js"]

# --- web: Next.js standalone server ---------------------------------------------------------------
FROM runtime AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public /app/apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
