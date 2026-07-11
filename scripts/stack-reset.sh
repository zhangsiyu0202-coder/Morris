#!/usr/bin/env bash
# Stop all containers AND delete data volumes (full reset).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker/docker-compose.yml" down -v
echo "stack-reset: stopped and volumes removed"
