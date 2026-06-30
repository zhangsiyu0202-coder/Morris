"""LiveKit Agent Worker health server (robustness-hardening REQ-3 Task 2.4).

Exposes `/_livez` (always 200 when the process is up) and `/_readyz` (200 when
backing services are reachable, 503 otherwise) on a separate port from the
LiveKit worker traffic. k8s probes this port without contending with the agent
loop.

Design:
  - stdlib `http.server` only. No aiohttp dependency so the module imports
    cleanly without `uv sync --extra realtime` (per `architecture.md`
    realtime-extras-opt-in rule).
  - Server runs in a daemon thread; `cli.run_app` blocking the main thread is
    fine. Daemon means the thread is killed on process exit without ceremony.
  - Dependency checks are sync (httpx.get with short timeout). The check
    surface is small: appwrite ping, livekit ws presence (env-shaped only),
    provider config presence.
  - Response shape mirrors `packages/contracts/src/health.ts`
    (HealthResponseSchema): boolean per dependency, no traceId, no secrets.
  - Prestop marker file: when present, /_readyz returns 503 with just
    {"shutting_down": true}. Drives k8s preStop drain.

NO real LLM/ASR/TTS API calls — probes fire every few seconds and would burn
tokens with no useful information (provider down = LLM call fails at runtime,
not probe time).
"""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

import httpx

from agent.logging import create_logger

log = create_logger("agent.health")


DEFAULT_PRESTOP_MARKER = "/tmp/merism.prestop"
"""Default marker location; matches the k8s manifest sample in
`docs/dev/health-and-drain.md` and the web side's `lib/health/prestop.ts`."""


def get_prestop_marker_path() -> str | None:
    """Resolve the configured marker path. None when env unset."""
    path = os.environ.get("MERISM_PRESTOP_MARKER_FILE")
    if not path:
        return None
    return path


def is_shutting_down() -> bool:
    """True iff the configured prestop marker file currently exists.

    Returns False when the env var is unset (safe default per
    `errors-and-observability.md` § Feature flags rule). EACCES or other
    fs error → False (treat as NOT shutting down, fail safe).
    """
    path = get_prestop_marker_path()
    if not path:
        return False
    try:
        return os.path.exists(path)
    except OSError:
        return False


def write_prestop_marker() -> str | None:
    """Write the prestop marker file. Called by the SIGTERM handler.

    Returns the path written, or None if marker is disabled by env.
    """
    path = get_prestop_marker_path()
    if not path:
        return None
    try:
        # Atomic-ish: touch the file.
        with open(path, "w") as f:
            f.write("draining\n")
        log.info("prestop.marker.written", path=path)
        return path
    except OSError as error:
        log.error("prestop.marker.write_failed", path=path, error=str(error))
        return None


def _ping_appwrite(timeout_s: float = 3.0) -> bool:
    """GET <APPWRITE_ENDPOINT>/health/version. False on any failure / unconfigured."""
    endpoint = os.environ.get("APPWRITE_ENDPOINT")
    if not endpoint:
        return False
    url = endpoint.rstrip("/") + "/health/version"
    try:
        r = httpx.get(url, timeout=timeout_s)
        return r.status_code < 500
    except (httpx.HTTPError, Exception):  # noqa: BLE001 - probe must never raise
        return False


def _check_livekit_configured() -> bool:
    """LiveKit reachability check (env-shaped only — no real ws connect)."""
    return bool(os.environ.get("LIVEKIT_URL"))


def _check_providers_configured() -> bool:
    """At least one LLM provider key present. Per ADR-0011, Qwen-VL is primary."""
    return bool(os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("DEEPSEEK_API_KEY"))


def run_readiness_checks() -> dict[str, bool]:
    """Run the agent's readiness check set. Returns dict shaped like
    `HealthResponseSchema` (booleans only, no extras).

    The agent set is: appwrite + livekit + providers (per
    `apps/web/lib/health/checks.ts::ROLE_DEPENDENCIES.agent`).
    """
    return {
        "appwrite": _ping_appwrite(),
        "livekit": _check_livekit_configured(),
        "providers": _check_providers_configured(),
    }


class _HealthHandler(BaseHTTPRequestHandler):
    """Minimal request handler. No logging to stderr (handler.log_message
    overridden to avoid the default access-log spam — probes fire often)."""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlparse(self.path).path
        if path == "/_livez":
            self._json(200, {"http": True})
            return
        if path == "/_readyz":
            if is_shutting_down():
                self._json(503, {"shutting_down": True})
                return
            results = run_readiness_checks()
            status = 200 if all(results.values()) else 503
            self._json(status, results)
            return
        self._json(404, {"error": "not_found"})

    def _json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    # Silence access logs — k8s probes hit several times a second per pod.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - parent API
        return


def start_health_server(port: int | None = None) -> ThreadingHTTPServer:
    """Start the health HTTP server in a daemon thread.

    Returns the server instance so callers can `.shutdown()` it (mainly for
    tests). In production the daemon thread is killed on process exit.

    Port: `HEALTH_PORT` env (default 8081). Binds 0.0.0.0 so k8s probes can
    reach it across the pod network.
    """
    resolved_port = port if port is not None else int(os.environ.get("HEALTH_PORT", "8081"))
    server = ThreadingHTTPServer(("0.0.0.0", resolved_port), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, name="merism-health", daemon=True)
    thread.start()
    log.info("agent.health.started", port=resolved_port)
    return server
