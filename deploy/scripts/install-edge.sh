#!/usr/bin/env bash
# First installation of the Venue Edge Server on an Ubuntu/Debian host.
#   sudo apt-get install -y docker.io docker-compose-v2   # or Docker CE
#   ./deploy/scripts/install-edge.sh poker.royalclub.example
set -euo pipefail
cd "$(dirname "$0")/../.."

HOSTNAME_ARG="${1:-}"
command -v docker >/dev/null || { echo "Docker is required (apt-get install docker.io docker-compose-v2)"; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 plugin is required"; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  rand() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 24)|" .env
  sed -i "s|^EDGE_NODE_ID=.*|EDGE_NODE_ID=edge-$(hostname -s)|" .env
  if [ -n "$HOSTNAME_ARG" ]; then
    sed -i "s|^LOCAL_HOSTNAME=.*|LOCAL_HOSTNAME=${HOSTNAME_ARG}|" .env
    sed -i "s|^LOCAL_APP_URL=.*|LOCAL_APP_URL=https://${HOSTNAME_ARG}|" .env
    sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${HOSTNAME_ARG}|" .env
  fi
  chmod 600 .env
  echo "Created .env with fresh secrets (keep it private; never commit it)."
fi

# Services restart automatically after a reboot (restart: unless-stopped).
sudo systemctl enable --now docker >/dev/null 2>&1 || true

docker compose up -d --build
echo "Waiting for the API…"
for _ in $(seq 1 60); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 2
done

echo
docker compose logs api 2>/dev/null | grep -A4 "FIRST-RUN SETUP" | tail -n 5 || true
echo
echo "Open https://${HOSTNAME_ARG:-<edge-ip>} from a device on the venue network and complete setup with the token above."
echo "With CADDY_TLS=internal, install Caddy's root certificate on staff devices:"
echo "  docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./pcos-local-root.crt"
