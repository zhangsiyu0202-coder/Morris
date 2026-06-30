# Health endpoints & graceful drain

> Source spec: `.kiro/specs/robustness-hardening/` REQ-3 (Tasks 2.1-2.6).

MerismV2 exposes k8s-style liveness + readiness probes on two surfaces:

- **Web** — Next.js route handlers at `/_health/livez` and `/_health/readyz`
  (served by the same `apps/web` process as the researcher UI / Morris API).
- **Agent** — a stdlib HTTP server on `HEALTH_PORT` (default `8081`) inside
  the LiveKit Agent Worker process (`apps/agent`). Independent of LiveKit
  traffic so the probe answers even when the worker is fully busy.

Both expose the same response shape (per `packages/contracts/src/health.ts` /
`HealthResponseSchema`): booleans only, no `traceId`, no error messages.

## Endpoints

### Liveness — `GET /_health/livez`

Always returns `200 {"http": true}` while the runtime is responsive. NO
dependency checks. Used by k8s `livenessProbe`; any non-200 → pod restart.

```bash
curl http://localhost:3000/_health/livez   # web
curl http://localhost:8081/_livez          # agent
```

### Readiness — `GET /_health/readyz`

Returns:

- `200` + per-dependency map when ALL checked deps healthy.
- `503` + `{"shutting_down": true}` when prestop marker exists (k8s preStop
  drain). All other checks short-circuited.
- `503` + per-dependency map when any check failed.
- `400 {"error": "invalid_role"}` for an unknown `?role` (web only).

Web accepts `?role=web|interview|function` to scope the dependency set.
Defaults to `web`.

```bash
curl http://localhost:3000/_health/readyz?role=web   # web default
curl http://localhost:8081/_readyz                    # agent
```

| Role / process | Deps checked |
|---|---|
| Web `role=web` (default) | Appwrite, cache |
| Web `role=interview` | Appwrite, cache |
| Web `role=function` | Appwrite |
| Agent | Appwrite, LiveKit (env presence), provider config (env presence) |

NO real LLM / ASR / TTS API calls — probes fire every few seconds and would
burn tokens with no useful signal (provider down = LLM call fails at
runtime, not probe time).

## Graceful drain

Both processes honor a prestop marker file:

- Env: `MERISM_PRESTOP_MARKER_FILE` (default unset = disabled)
- Default path when set: `/tmp/merism.prestop`

When the marker exists, `/_health/readyz` returns `503 {"shutting_down":
true}` immediately. The orchestrator stops routing new traffic; in-flight
requests / rooms finish naturally.

The agent process additionally installs a `SIGTERM` (and `SIGINT`) handler
that writes the marker on the first signal. This lets `kubectl delete pod`
trigger the same drain as `preStop`.

### k8s manifest sample (future state — we don't run k8s yet)

```yaml
spec:
  containers:
    - name: merism-web
      env:
        - name: MERISM_PRESTOP_MARKER_FILE
          value: /tmp/merism.prestop
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "touch /tmp/merism.prestop && sleep 30"]
      livenessProbe:
        httpGet: { path: /_health/livez, port: 3000 }
        initialDelaySeconds: 5
        periodSeconds: 10
      readinessProbe:
        httpGet: { path: /_health/readyz, port: 3000 }
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 3
      terminationGracePeriodSeconds: 60
```

## Local manual test

```bash
# Web
pnpm dev &
curl -i http://localhost:3000/_health/livez
curl -i http://localhost:3000/_health/readyz

# Drain
export MERISM_PRESTOP_MARKER_FILE=/tmp/merism.prestop
touch /tmp/merism.prestop
curl -i http://localhost:3000/_health/readyz   # expect 503 + shutting_down
rm /tmp/merism.prestop
curl -i http://localhost:3000/_health/readyz   # recovers

# Agent
cd apps/agent && uv sync --extra realtime
HEALTH_PORT=8081 uv run python -m agent.main dev &
curl -i http://localhost:8081/_livez
curl -i http://localhost:8081/_readyz
```

## Configured env

| Var | Type | Default | Purpose |
|---|---|---|---|
| `HEALTH_PORT` | int | `8081` | Agent health server listen port |
| `MERISM_PRESTOP_MARKER_FILE` | path | unset (disabled) | Drain marker file path |

## Design notes (binding)

- Response body MUST NOT include `traceId` (probe responses fire often;
  leaking a server identifier per probe is an info-leak). Failing probes
  have full traceability in the server log keyed by request time, not in
  the response.
- Health module on the agent side uses **stdlib `http.server`** so it
  imports cleanly without `uv sync --extra realtime` (per `architecture.md`
  realtime-extras-opt-in rule).
- Probes are debug-level only in the log feed — operators read response
  codes, not the log feed, when triaging probe failures.

## Verification

```bash
pnpm test apps/web/lib/health           # 24 tests
pnpm test:py                            # includes 18 agent health tests
```
