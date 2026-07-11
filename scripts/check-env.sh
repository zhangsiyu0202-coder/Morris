#!/usr/bin/env bash
# Validate required env vars exist (in .env or environment) before starting the stack.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

REQUIRED=(
  APPWRITE_ENDPOINT APPWRITE_PROJECT_ID APPWRITE_API_KEY
  LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET
  QWEN_API_KEY DEEPSEEK_API_KEY STT_PROVIDER_KEY TTS_PROVIDER_KEY
)

missing=()
for v in "${REQUIRED[@]}"; do
  [ -z "${!v:-}" ] && missing+=("$v")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: missing required env vars:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "Copy .env.example to .env and fill them in." >&2
  exit 1
fi
echo "check-env: OK"
