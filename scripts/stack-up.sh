#!/usr/bin/env bash
# Bring up Appwrite + LiveKit and wait until healthy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/infra/docker/docker-compose.yml"

bash "$ROOT/scripts/check-env.sh"
docker compose --env-file "$ROOT/.env" -f "$COMPOSE" up -d

echo "Waiting for Appwrite to become healthy (max 5 min)..."
for i in $(seq 1 60); do
  # Any HTTP response (incl. 401) means the API is serving; only a connection
  # failure (code 000) counts as not-ready.
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/v1/health/version || echo 000)
  if [ "$code" != "000" ]; then
    appwrite_ok=1; break
  fi
  sleep 5
done

if [ "${appwrite_ok:-0}" != "1" ]; then
  echo "ERROR: Appwrite did not become healthy in time" >&2
  exit 1
fi

echo "OK"
echo "  Appwrite:  http://localhost:8080"
echo "  Realtime:  ws://localhost:8081/v1/realtime"
echo "  LiveKit:   ws://localhost:7880"
