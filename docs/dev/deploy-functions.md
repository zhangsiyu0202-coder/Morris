# Deploying Appwrite Functions to the local stack

Walks through deploying the four Functions in `apps/functions/*` against
the local Docker stack. Same procedure works against a remote Appwrite
instance with the corresponding env values.

## Prerequisites

The local stack must include OpenRuntimes. The `infra/docker/docker-compose.yml`
ships them by default; if your checkout predates that, add them per the
status comment above the `openruntimes-executor` service block.

The four services are:

- `openruntimes-executor` (image `openruntimes/executor:0.6.11`) -
  spawns runtime containers per execution.
- `openruntimes-proxy` (image `openruntimes/proxy:0.5.5`, hostname
  alias `appwrite-executor`) - proxies dispatch + result back to
  Appwrite.
- `appwrite-task-scheduler-functions` - schedules events / triggers.
- `appwrite-task-scheduler-executions` - tracks running executions.

Plus three required infra adjustments:

- `runtimes` network is pinned to the literal name `runtimes` (no
  compose prefix) so OpenRuntimes' `OPR_EXECUTOR_NETWORK=runtimes`
  resolves to the same network the spawned runtime container joins.
- `appwrite` and `livekit` services are dual-attached to `default` +
  `runtimes` (with hostname aliases) so deployed Function code can
  call back via `http://appwrite/v1/*` and `ws://livekit:7880`.
- `_APP_DOMAIN_FUNCTIONS=functions.localhost` is set on the appwrite
  service. Without this, Appwrite's router uses
  `str_ends_with($host, "")` which is unconditionally true, so every
  hostname falls into the "function subdomain" branch and Function
  callbacks return a 401 HTML console page. This was the single
  longest-running diagnostic in the self-hosted setup.

Bring the stack up:

```bash
pnpm stack:up           # starts Appwrite + LiveKit + OpenRuntimes
pnpm schema:apply       # idempotent collection / bucket setup
```

If this is the first time running against a fresh-volumes Appwrite
(after `pnpm stack:reset`), bootstrap project + API key first:

```bash
. .env
EP=http://localhost:8080/v1

# 1. signup admin (first user gets root scope on console)
curl -s -X POST "$EP/account" -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -d '{"userId":"unique()","email":"admin@merism.local","password":"merismadmin","name":"Admin"}'

# 2. login
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST "$EP/account/sessions/email" \
  -H "Content-Type: application/json" -H "X-Appwrite-Project: console" \
  -d '{"email":"admin@merism.local","password":"merismadmin"}'

# 3. team + project
curl -s -b "$COOKIE_JAR" -X POST "$EP/teams" \
  -H "Content-Type: application/json" -H "X-Appwrite-Project: console" \
  -d '{"teamId":"merism-team","name":"Merism Local"}'
curl -s -b "$COOKIE_JAR" -X POST "$EP/projects" \
  -H "Content-Type: application/json" -H "X-Appwrite-Project: console" \
  -d '{"projectId":"merism","name":"MerismV2","teamId":"merism-team","region":"default"}'

# 4. API key (server-side scope)
curl -s -b "$COOKIE_JAR" -X POST "$EP/projects/merism/keys" \
  -H "Content-Type: application/json" -H "X-Appwrite-Project: console" \
  -d '{"name":"agent-server-key","scopes":["users.read","users.write","databases.read","databases.write","collections.read","collections.write","attributes.read","attributes.write","indexes.read","indexes.write","documents.read","documents.write","files.read","files.write","buckets.read","buckets.write","functions.read","functions.write","execution.read","execution.write","sessions.write","health.read","teams.read","teams.write"]}'
# write the returned `secret` into APPWRITE_API_KEY in .env
```

## One-shot deploy

For each Function in `apps/functions/<name>/`:

```bash
# 1. create the Function record (metadata: runtime + entrypoint + commands)
. .env
EP=http://localhost:8080/v1
PID=merism

for FN in issueLivekitToken analyzeSession analyzeSurvey analyzeSessionVisual; do
  curl -s -X POST "$EP/functions" \
    -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"functionId\":\"$FN\",\"name\":\"$FN\",\"runtime\":\"node-21.0\",\"execute\":[\"any\"],\"timeout\":600,\"enabled\":true,\"logging\":true,\"entrypoint\":\"dist/main.js\",\"commands\":\"npm install --omit=dev\"}"
done

# 2. build all Functions (tsup bundles workspace deps; runtime SDKs stay external)
pnpm -r --filter './apps/functions/*' build

# 3. push the bundles + minimal package.json to Appwrite
for FN in issueLivekitToken analyzeSession analyzeSurvey analyzeSessionVisual; do
  scripts/deploy-function.sh "$FN"
done

# 4. push env vars onto each Function (rewrites localhost -> appwrite/livekit
#    so in-runtime SDK calls reach the right hosts)
for FN in issueLivekitToken analyzeSession analyzeSurvey analyzeSessionVisual; do
  scripts/set-function-vars.sh "$FN"
done

# 5. issueLivekitToken needs a separate LIVEKIT_INTERNAL_URL var so the
#    Function's RoomServiceClient reaches LiveKit at ws://livekit:7880
#    while the response body still tells the browser ws://localhost:7880
curl -s -X POST "$EP/functions/issueLivekitToken/variables" \
  -H "X-Appwrite-Project: $PID" -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"LIVEKIT_INTERNAL_URL","value":"ws://livekit:7880"}'
```

## Verify

```bash
# 1. all four built (status=ready, buildSize > 1 MB confirms node_modules included)
. .env
for FN in issueLivekitToken analyzeSession analyzeSurvey analyzeSessionVisual; do
  curl -s -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
    "$APPWRITE_ENDPOINT/functions/$FN/deployments" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); dep=d['deployments'][0]; print(f'$FN status={dep[\"status\"]} buildSize={dep[\"buildSize\"]}')"
done

# 2. invoke issueLivekitToken with a malformed body — expect 400 invalid_input
curl -s -X POST -H "X-Appwrite-Project: $APPWRITE_PROJECT_ID" -H "X-Appwrite-Key: $APPWRITE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"{\"foo\":\"bar\"}","async":false,"path":"/","method":"POST"}' \
  "$APPWRITE_ENDPOINT/functions/issueLivekitToken/executions" | python3 -m json.tool | head -10
# expected: status=completed, responseStatusCode=400, responseBody={"error":"invalid_input"}
```

## Caveats

- **30 s sync timeout is hardcoded in Appwrite 1.6**. Functions that
  need longer (e.g. analyzeSessionVisual which uploads a multi-MB mp4
  to Gemini Vision) must run with `async=true`. The agent worker's
  `trigger_post_session_analysis` already dispatches sync because
  analyzeSession + analyzeSurvey complete in 8-12 s; analyzeSessionVisual
  is dispatched async by the egress finalize hook.

- **SDK 20.x vs server 1.6 response-shape skew**. The Appwrite Python
  SDK targets the unreleased 1.9.5 response format. Calls to deployed
  Functions succeed on the wire but the SDK's pydantic Execution model
  rejects responses because `deploymentId` is absent. The agent
  worker's `_FunctionsAdapter.create_execution` swallows this via the
  `_is_sdk_skew_error` helper (see
  `apps/agent/agent/persistence/appwrite_repository.py`). When
  Appwrite ships 1.9.x for Docker Hub the helper can be removed.

- **Scheduling**. Functions can be scheduled (`schedule` field on the
  Function record), but Merism doesn't use scheduled execution —
  every Function runs in response to an explicit `create_execution`
  call from the agent worker (`trigger_post_session_analysis`),
  the egress finalize hook (`enqueue_visual_analysis`), or the
  browser bootstrap (`issueLivekitToken`).

- **`scripts/run-analyze-*.mts`** (run-analyze-session.mts,
  run-analyze-survey.mts, run-analyze-session-visual.mts) call the
  Function handler directly with `createRealDeps()`, bypassing the
  Appwrite execution path entirely. Use these for local dev iteration
  on the analysis logic; the deployed Function is the production path.

## Adding a new Function

1. Scaffold under `apps/functions/<name>/` using `apps/functions/issueLivekitToken/`
   as the reference shape (handler.ts pure core + main.ts SDK wrapper +
   deps.ts).
2. Bundle config in `tsup.config.ts`: `noExternal: [/@merism\//]`,
   `external: [<runtime SDKs>]`.
3. Add the Function id to the loop in the deploy section above.
4. If the Function needs new env vars, add them to the NAMES array in
   `scripts/set-function-vars.sh`.
5. Per `architecture.md` Function shape rules: `handler.ts` must not
   import any SDK; all I/O goes through the typed `Deps` interface.
