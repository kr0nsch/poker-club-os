#!/usr/bin/env bash
# Restore the database from a pg_dump custom-format file.
#   ./deploy/scripts/restore.sh backups/pcos-20260928-203000.dump
# The API and worker are stopped during the restore and started again afterwards.
set -euo pipefail
cd "$(dirname "$0")/../.."
file="${1:?usage: restore.sh <backup.dump>}"
[ -f "$file" ] || { echo "no such file: $file"; exit 1; }
set -a; . ./.env; set +a
DB="${POSTGRES_DB:-pcos}"
USER="${POSTGRES_USER:-pcos}"

read -r -p "This REPLACES the current database '$DB' with $file. Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }

docker compose stop api worker web
docker compose exec -T postgres psql -U "$USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$DB\" ENCODING 'UTF8' TEMPLATE template0;"
docker compose exec -T postgres pg_restore -U "$USER" -d "$DB" --no-owner --exit-on-error < "$file"
docker compose start api worker web
echo "Restored $file into $DB. Tournament clocks resume from their persisted state."
