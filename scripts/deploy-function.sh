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
# Set MERISM_NPM_PROXY only when the Appwrite build container needs an HTTP(S)
# proxy to download external runtime dependencies. It is written to the staged
# .npmrc only; it is never added to source control or Function variables.

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
ENTRYPOINT="$(node -e "const p=require('$SRC/package.json'); process.stdout.write(p.appwriteEntrypoint || 'dist/main.js')")"
if [ ! -f "$SRC/$ENTRYPOINT" ]; then
  echo "no $ENTRYPOINT — run 'pnpm -F $(jq -r .name "$SRC/package.json") build' first" >&2
  exit 1
fi

# Load .env (gitignored).
set -a
. "$ROOT/.env"
set +a
: "${APPWRITE_ENDPOINT:?}"
: "${APPWRITE_PROJECT_ID:?}"
: "${APPWRITE_API_KEY:?}"

# Stage just the bundle + a minimal package.json (remaining external deps only)
# so Appwrite's build runs `npm install` on a small surface, not on the
# workspace tree. A Function may declare `appwriteBundledDependencies` for
# runtime packages already embedded by tsup; keeping those here would make an
# otherwise self-contained deployment depend on registry access.
STAGE="$(mktemp -d)"
trap "rm -rf '$STAGE'" EXIT
# tsup may emit sibling chunks for dynamic imports. Copy the complete entrypoint
# directory, not merely main.js, so Node can resolve those ESM chunks at
# runtime inside Appwrite.
ENTRYPOINT_DIR="$(dirname "$ENTRYPOINT")"
if [ "$ENTRYPOINT_DIR" = "." ]; then
  cp "$SRC/$ENTRYPOINT" "$STAGE/$ENTRYPOINT"
else
  cp -R "$SRC/$ENTRYPOINT_DIR" "$STAGE/$ENTRYPOINT_DIR"
fi

# Strip workspace deps from package.json (they're bundled by tsup) so npm
# install in the function container doesn't try to resolve them. Keep
# `dependencies` for runtime SDKs.
node -e "
  const p = require('$SRC/package.json');
  const bundled = new Set(p.appwriteBundledDependencies || []);
  const dependencies = Object.fromEntries(
    Object.entries(p.dependencies || {}).filter(([name]) => !bundled.has(name)),
  );
  const minimal = {
    name: p.name.replace(/^@merism\\//, ''),
    version: p.version || '0.0.0',
    type: p.appwritePackageType || p.type || 'module',
    main: p.appwriteEntrypoint || 'dist/main.js',
    dependencies,
  };
  require('fs').writeFileSync('$STAGE/package.json', JSON.stringify(minimal, null, 2));
"

# Appwrite runs `npm install` inside an isolated build container. When its
# network cannot reach the registry directly, include an npm-only proxy config
# in this deployment archive. Keep this opt-in so remote deployments preserve
# their own egress policy.
if [ -n "${MERISM_NPM_PROXY:-}" ]; then
  printf 'proxy=%s\nhttps-proxy=%s\n' "$MERISM_NPM_PROXY" "$MERISM_NPM_PROXY" \
    > "$STAGE/.npmrc"
fi

# Tarball.
TARBALL="$STAGE/code.tar.gz"
if [ "$ENTRYPOINT_DIR" = "." ]; then
  TAR_INPUTS=("$ENTRYPOINT" package.json)
else
  TAR_INPUTS=("$ENTRYPOINT_DIR" package.json)
fi
if [ -f "$STAGE/.npmrc" ]; then
  TAR_INPUTS+=(.npmrc)
fi
( cd "$STAGE" && tar -czf "$TARBALL" "${TAR_INPUTS[@]}" )

# Push deployment via REST. Activate=true so the new build replaces the
# previous (or first-ever) deployment as soon as it goes live.
echo "deploying $FN -> $APPWRITE_ENDPOINT/functions/$FN/deployments ..."
RESP=$(curl -sS -X POST \
  -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" \
  -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  -F "code=@$TARBALL" \
  -F 'activate=true' \
  -F "entrypoint=$ENTRYPOINT" \
  "$APPWRITE_ENDPOINT/functions/$FN/deployments")
echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
