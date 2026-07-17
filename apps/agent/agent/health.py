"""Tiny readiness surface used by the repo development orchestrator."""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


def readiness() -> dict[str, bool]:
    return {
        "appwrite": bool(os.getenv("APPWRITE_ENDPOINT")),
        "livekit": bool(os.getenv("LIVEKIT_URL")),
        "providers": bool(
            os.getenv("GEMINI_LIVE_API_KEY")
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
        ),
    }


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/_livez":
            self._respond(200, {"http": True})
        elif path == "/_readyz":
            checks = readiness()
            self._respond(200 if all(checks.values()) else 503, checks)
        else:
            self._respond(404, {"error": "not_found"})

    def _respond(self, status: int, value: dict[str, Any]) -> None:
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def start_health_server(port: int | None = None) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port or int(os.getenv("HEALTH_PORT", "8082"))), _Handler)
    threading.Thread(target=server.serve_forever, name="merism-agent-health", daemon=True).start()
    return server
