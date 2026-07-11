#!/usr/bin/env bash
# Run all Python subproject test suites via uv.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/merism-uv-cache}"

for proj in "$ROOT/apps/agent"; do
  echo "==> pytest in $proj"
  (cd "$proj" && uv run --group dev pytest -q)
done
