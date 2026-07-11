#!/usr/bin/env bash
# Deploy a built Appwrite Function from apps/functions/<name> to the local
# Appwrite stack. Each Function is bundled by tsup into dist/main.js with
# workspace deps inlined and runtime SDKs (node-appwrite, livekit-server-sdk,
# etc.) listed as `dependencies` in its package.json. Appwrite's function
# build container runs `npm install` on this minimal package.json then loads
# `dist/main.js` per the entrypoint we configured at create-function time.
#
# Usage:  scripts/deploy-function.sh <functionName>
# Example: scripts/deploy-function.sh issueLivekitToken
#
# Reads APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY from .env.

set -euo pipefail

FN="${1:-}"
if [ -z "$FN" ]; then
  echo "usage: $0 <functionName>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/apps/functions/$FN"
if [ ! -d "$SRC" ]; then
  echo "no such function: $SRC" >&2
  exit 1
fi
if [ ! -f "$SRC/dist/main.js" ]; then
  echo "no dist/main.js — run 'pnpm -F $(jq -r .name "$SRC/package.json") build' first" >&2
  exit 1
fi

# Load .env (gitignored).
set -a
. "$ROOT/.env"
set +a
: "${APPWRITE_ENDPOINT:?}"
: "${APPWRITE_PROJECT_ID:?}"
: "${APPWRITE_API_KEY:?}"

# Stage just the bundle + a minimal package.json (deps only) so Appwrite's
# build runs `npm install` on a small surface, not on the workspace tree.
STAGE="$(mktemp -d)"
trap "rm -rf '$STAGE'" EXIT
mkdir -p "$STAGE/dist"
cp "$SRC/dist/main.js" "$STAGE/dist/main.js"

# Strip workspace deps from package.json (they're bundled by tsup) so npm
# install in the function container doesn't try to resolve them. Keep
# `dependencies` for runtime SDKs.
node -e "
  const p = require('$SRC/package.json');
  const minimal = {
    name: p.name.replace(/^@merism\\//, ''),
    version: p.version || '0.0.0',
    type: p.type || 'module',
    main: 'dist/main.js',
    dependencies: p.dependencies || {},
  };
  require('fs').writeFileSync('$STAGE/package.json', JSON.stringify(minimal, null, 2));
"

# Tarball.
TARBALL="$STAGE/code.tar.gz"
( cd "$STAGE" && tar -czf "$TARBALL" dist package.json )

# Push deployment via REST. Activate=true so the new build replaces the
# previous (or first-ever) deployment as soon as it goes live.
echo "deploying $FN -> $APPWRITE_ENDPOINT/functions/$FN/deployments ..."
RESP=$(curl -sS -X POST \
  -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
  -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  -F "code=@$TARBALL" \
  -F 'activate=true' \
  -F 'entrypoint=dist/main.js' \
  "$APPWRITE_ENDPOINT/functions/$FN/deployments")
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
