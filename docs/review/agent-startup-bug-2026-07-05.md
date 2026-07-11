# Agent startup bug

Status: investigation in progress

## Summary

Local startup is still blocked by the LiveKit worker handshake plus an agent health-port collision.

## Confirmed facts

- `pnpm -F @merism/web start` works and serves the web app on `http://127.0.0.1:3000`.
- `pnpm stack:up` / `docker compose` stack is up: Appwrite on `8080`, LiveKit on `7880`.
- `.env` already contains the required API values for Appwrite, DeepSeek, Qwen, and LiveKit.

## Bugs observed

1. Agent health port collision
- `apps/agent/agent/health.py` defaults to `HEALTH_PORT=8081`.
- `8081` is already used by Appwrite Realtime in the local stack.
- Starting the agent without overriding `HEALTH_PORT` fails with `OSError: [Errno 98] Address already in use`.

2. Agent startup without env loading
- If the agent is started without sourcing `.env`, it fails with:
  - `ValueError: ws_url is required, or set LIVEKIT_URL environment variable`

3. Agent health port collision
- `apps/agent/agent/health.py` still defaults to `HEALTH_PORT=8081`.
- `8081` is already used by Appwrite Realtime in the local stack.
- Starting the agent without overriding `HEALTH_PORT` still fails with `OSError: [Errno 98] Address already in use`.

4. LiveKit handshake failure is still unresolved
- The worker still logs repeated `502 Invalid response status` while connecting to `ws://127.0.0.1:7880/agent`.
- A direct unauthenticated websocket upgrade to `/agent` returns `401 Unauthorized` with `no permissions to access the room`.
- Removing the space from `LIVEKIT_KEYS` was tested and is NOT the fix: it makes the LiveKit server crash with `Could not parse keys, it needs to be exactly, "key: secret", including the space`.

## Repro

1. Start local stack.
2. Start web with `pnpm -F @merism/web start`.
3. Start agent without env loading.
4. Observe missing `LIVEKIT_URL`.
5. Start agent with env loaded but default health port.
6. Observe port collision on `8081`.
7. Start agent with env loaded and `HEALTH_PORT=8082`.
8. Observe the worker still fails to complete the LiveKit handshake.

## Evidence

- Web log: `Ready in 900ms`
- Agent log: `ValueError: ws_url is required, or set LIVEKIT_URL environment variable`
- Agent log: `OSError: [Errno 98] Address already in use`
- Docker logs after removing the space: `Could not parse keys, it needs to be exactly, "key: secret", including the space`
- `curl -i -N` websocket upgrade to `http://127.0.0.1:7880/agent` returned `401 Unauthorized` with `no permissions to access the room`

## Remaining work

- Diagnose why a valid agent worker still receives `502` from the `/agent` websocket route.
- Decide whether `HEALTH_PORT` should default away from `8081` in local dev, or whether the startup command should always override it.
- Once the startup path is stable, add a regression check for the agent launch command.
