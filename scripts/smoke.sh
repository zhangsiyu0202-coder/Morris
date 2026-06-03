#!/usr/bin/env bash
# Local-stack smoke test: stack-up -> schema:apply -> issue a token end-to-end.
# Set SMOKE_SKIP_STACK=1 if the stack is already running. SMOKE_RESET=1 to reset after.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${SMOKE_SKIP_STACK:-0}" != "1" ]; then
  bash scripts/stack-up.sh
fi

pnpm schema:apply
tsx scripts/smoke.ts

if [ "${SMOKE_RESET:-0}" = "1" ]; then
  bash scripts/stack-reset.sh
fi
