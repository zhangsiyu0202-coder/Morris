#!/usr/bin/env bash
# Stop all containers, preserve named volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker/docker-compose.yml" down
echo "stack-down: stopped (data volumes preserved)"
