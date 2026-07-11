#!/usr/bin/env bash
# Push environment variables onto a deployed Appwrite Function. Inside the
# function runtime container the SDK must reach Appwrite at a docker-network
# hostname (e.g. "appwrite") rather than localhost; this script also
# substitutes the localhost endpoint with the in-network one when seen in
# the .env value.
#
# Usage: scripts/set-function-vars.sh <functionName> [VAR_NAME ...]
# Reads the listed vars from .env (or all *_KEY/*_URL/*_API_* vars by default)
# and pushes them to the function with PUT/POST.
set -euo pipefail
FN="${1:-}"
shift || true
[ -z "$FN" ] && { echo "usage: $0 <functionName> [VAR_NAME ...]" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
EP="$APPWRITE_ENDPOINT"
PID="$APPWRITE_PROJECT_ID"
KEY="$APPWRITE_API_KEY"

# Inside the runtime container, "localhost:8080" doesn't resolve to Appwrite.
# Substitute the in-network address; the runtime is on the same docker
# bridge as the Appwrite container.
in_network_endpoint() {
  echo "${1/http:\/\/localhost:8080/http:\/\/appwrite\/v1}" | sed 's|/v1/v1|/v1|'
}

# Pick the var names from argv; if none, pick a sensible default set.
if [ "$#" -gt 0 ]; then
  NAMES=("$@")
else
  NAMES=(
    APPWRITE_ENDPOINT APPWRITE_PROJECT_ID APPWRITE_API_KEY
    LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET
    LIVEKIT_TOKEN_TTL_SECONDS
    DEEPSEEK_API_KEY DEEPSEEK_MODEL DEEPSEEK_BASE_URL
    GEMINI_API_KEY GEMINI_API_BASE_URL GEMINI_VISUAL_ANALYSIS_ENABLED
    GEMINI_VISUAL_MODEL
    QWEN_API_KEY DASHSCOPE_API_KEY
  )
fi

# List existing vars for delete-then-create idempotence.
EXISTING=$(curl -s -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
  "$EP/functions/$FN/variables")

for NAME in "${NAMES[@]}"; do
  VAL="${!NAME:-}"
  [ -z "$VAL" ] && continue

  # Network-rewrite for endpoint vars.
  if [[ "$NAME" == "APPWRITE_ENDPOINT" || "$NAME" == "APPWRITE_FUNCTION_API_ENDPOINT" ]]; then
    VAL="$(in_network_endpoint "$VAL")"
  fi

  # Delete any prior value (idempotent).
  EXISTING_ID=$(echo "$EXISTING" | python3 -c "
import sys, json
d=json.load(sys.stdin)
for v in d.get('variables',[]):
    if v.get('key') == '$NAME':
        print(v.get('\$id',''))
        break")
  if [ -n "$EXISTING_ID" ]; then
    curl -s -X DELETE -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
      "$EP/functions/$FN/variables/$EXISTING_ID" > /dev/null
  fi

  # Create.
  RESP=$(curl -s -X POST -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys; print(json.dumps({'key':'$NAME','value':sys.argv[1]}))" "$VAL")" \
    "$EP/functions/$FN/variables")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('\$id') else 'ERR: '+str(d.get('message','')))")
  echo "  $NAME -> $STATUS"
done
