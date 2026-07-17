#!/usr/bin/env bash
# Push environment variables onto a deployed Appwrite Function. Inside the
# function runtime container the SDK must reach Appwrite at a docker-network
# hostname (e.g. "appwrite") rather than localhost; this script also
# substitutes the localhost endpoint with the in-network one when seen in
# the .env value.
#
# Usage: scripts/set-function-vars.sh <functionName> [VAR_NAME ...]
# Reads the listed vars from .env (or all *_KEY/*_URL/*_API_* vars by default)
# and pushes them to the function with PUT/POST. Appwrite requires a distinct
# variable ID as well as an environment key, so new IDs are deterministic and
# repeated invocations update variables in place.
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
    MERISM_VOICE_AGENT_NAME
    LIVEKIT_TOKEN_TTL_SECONDS
    DEEPSEEK_API_KEY DEEPSEEK_MODEL DEEPSEEK_BASE_URL
    AIHUBMIX_API_KEY AIHUBMIX_BASE_URL ANALYSIS_RERANK_MODEL ANALYZE_EVIDENCE_FUNCTION_ID
    GEMINI_API_KEY GEMINI_API_BASE_URL GEMINI_VISUAL_ANALYSIS_ENABLED
    GEMINI_VISUAL_MODEL
    QWEN_API_KEY DASHSCOPE_API_KEY
  )
fi

# List existing vars for update-or-create idempotence.
EXISTING=$(curl -s -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
  "$EP/functions/$FN/variables")

for NAME in "${NAMES[@]}"; do
  VAL="${!NAME:-}"
  [ -z "$VAL" ] && continue

  # Network-rewrite for endpoint vars.
  if [[ "$NAME" == "APPWRITE_ENDPOINT" || "$NAME" == "APPWRITE_FUNCTION_API_ENDPOINT" ]]; then
    VAL="$(in_network_endpoint "$VAL")"
  fi

  # Appwrite exposes the immutable variable id separately from its environment
  # key. Reuse it when present; otherwise make a stable valid ID below 36
  # characters so retries cannot create duplicates.
  EXISTING_ID=$(echo "$EXISTING" | python3 -c "
import sys, json
d=json.load(sys.stdin)
for v in d.get('variables',[]):
    if v.get('key') == '$NAME':
        print(v.get('\$id',''))
        break")
  SECRET=false
  if [[ "$NAME" == *_KEY || "$NAME" == *_SECRET ]]; then
    SECRET=true
  fi

  if [ -n "$EXISTING_ID" ]; then
    RESP=$(curl -s -X PUT -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "import json,sys; print(json.dumps({'key':sys.argv[1],'value':sys.argv[2],'secret':sys.argv[3] == 'true'}))" "$NAME" "$VAL" "$SECRET")" \
      "$EP/functions/$FN/variables/$EXISTING_ID")
  else
    VARIABLE_ID="v_$(printf '%s' "$FN:$NAME" | sha256sum | cut -c1-32)"
    RESP=$(curl -s -X POST -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $KEY" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "import json,sys; print(json.dumps({'variableId':sys.argv[1],'key':sys.argv[2],'value':sys.argv[3],'secret':sys.argv[4] == 'true'}))" "$VARIABLE_ID" "$NAME" "$VAL" "$SECRET")" \
      "$EP/functions/$FN/variables")
  fi
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('\$id') else 'ERR: '+str(d.get('message','')))")
  echo "  $NAME -> $STATUS"
done
