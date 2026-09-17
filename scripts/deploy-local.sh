#!/usr/bin/env bash
# Build both apps and (re)start the local nginx deployment.
#
# Usage: scripts/deploy-local.sh
#
# Serves:
#   client      http://<host>:8080
#   Super Admin http://<host>:8081
#
# Requires the local Supabase stack (`supabase start`) for the backend.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building client"
npm run build

echo "==> Building Super Admin"
npm run --prefix "super Admin" build

echo "==> (Re)starting nginx"
docker compose -f deploy/local/docker-compose.yml up -d --force-recreate

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Local deployment up:"
echo "  client      http://${IP}:8080"
echo "  Super Admin http://${IP}:8081"
echo
echo "Logs: docker logs -f iotank-web"
