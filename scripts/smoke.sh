#!/usr/bin/env bash
# Local-stack smoke test: stack-up -> schema:apply -> issue a token -> finalize
# a session through deployed Functions.
# Set SMOKE_SKIP_STACK=1 if the stack is already running. SMOKE_RESET=1 to reset after.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a
. "$ROOT/.env"
set +a

if [ "${SMOKE_SKIP_STACK:-0}" != "1" ]; then
  bash scripts/stack-up.sh
fi

pnpm schema:apply
pnpm -F @merism/contracts build
pnpm --dir "$ROOT/apps/functions/issueLivekitToken" build
pnpm --dir "$ROOT/apps/functions/finalizeInterviewSession" build
bash scripts/ensure-function.sh issueLivekitToken
bash scripts/ensure-function.sh finalizeInterviewSession
bash scripts/deploy-function.sh issueLivekitToken
bash scripts/deploy-function.sh finalizeInterviewSession
LIVEKIT_INTERNAL_URL="ws://livekit:7880" bash scripts/set-function-vars.sh issueLivekitToken APPWRITE_ENDPOINT APPWRITE_PROJECT_ID APPWRITE_API_KEY LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_TOKEN_TTL_SECONDS LIVEKIT_INTERNAL_URL
bash scripts/set-function-vars.sh finalizeInterviewSession APPWRITE_ENDPOINT APPWRITE_PROJECT_ID APPWRITE_API_KEY
tsx scripts/smoke.mts

if [ "${SMOKE_RESET:-0}" = "1" ]; then
  bash scripts/stack-reset.sh
fi
