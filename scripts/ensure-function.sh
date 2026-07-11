#!/usr/bin/env bash
set -euo pipefail

FN="${1:-}"
if [ -z "$FN" ]; then
  echo "usage: $0 <functionName>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
. "$ROOT/.env"
set +a

: "${APPWRITE_ENDPOINT:?}"
: "${APPWRITE_PROJECT_ID:?}"
: "${APPWRITE_API_KEY:?}"

STATUS=$(curl -s -o /tmp/ensure-function-response.json -w "%{http_code}" \
  -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
  -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  "$APPWRITE_ENDPOINT/functions/$FN")

if [ "$STATUS" = "200" ]; then
  echo "function $FN already exists"
  exit 0
fi

if [ "$STATUS" != "404" ]; then
  echo "failed to inspect function $FN (status=$STATUS)" >&2
  cat /tmp/ensure-function-response.json >&2 || true
  exit 1
fi

RESP=$(curl -sS -X POST "$APPWRITE_ENDPOINT/functions" \
  -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
  -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"functionId\":\"$FN\",\"name\":\"$FN\",\"runtime\":\"node-21.0\",\"execute\":[\"any\"],\"timeout\":600,\"enabled\":true,\"logging\":true,\"entrypoint\":\"dist/main.js\",\"commands\":\"npm install --omit=dev\"}")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
