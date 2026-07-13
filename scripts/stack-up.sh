#!/usr/bin/env bash
# Bring up Appwrite + LiveKit and wait until healthy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/infra/docker/docker-compose.yml"

bash "$ROOT/scripts/check-env.sh"
docker compose --env-file "$ROOT/.env" -f "$COMPOSE" up -d

wait_for_ready() {
  local name="$1"
  local url="$2"
  echo "Waiting for $name readiness (max 5 min)..."
  for _ in $(seq 1 60); do
    # A successful HTTP response proves the service handler is ready; a bound
    # port or an arbitrary 4xx/5xx response does not.
    if curl -fsS --max-time 3 -o /dev/null "$url"; then
      return 0
    fi
    sleep 5
  done
  echo "ERROR: $name did not become ready in time ($url)" >&2
  return 1
}

wait_for_ready "Appwrite" "http://localhost:8080/v1/health/version"
wait_for_ready "LiveKit" "http://localhost:7880/"

echo "OK"
echo "  Appwrite:  http://localhost:8080"
echo "  Realtime:  ws://localhost:8081/v1/realtime"
echo "  LiveKit:   ws://localhost:7880"
