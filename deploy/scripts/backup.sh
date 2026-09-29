#!/usr/bin/env bash
# Manual database backup to ./backups (automatic backups are made by the worker
# into the edgedata volume every BACKUP_SCHEDULE_HOURS; see docs/BACKUP_RECOVERY.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
mkdir -p backups
file="backups/pcos-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-pcos}" --format=custom --no-owner "${POSTGRES_DB:-pcos}" > "$file"
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
