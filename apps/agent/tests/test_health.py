"""Tests for `agent/health.py` (robustness-hardening REQ-3 Task 2.4 + 2.5).

Coverage:
  - prestop: env unset → false; env + file present → true; env + file missing → false
  - readiness checks: per-dep env-shape correctness
  - /_livez always 200
  - /_readyz: prestop short-circuit; 200 all-healthy; 503 on any failure
  - response body shape mirrors HealthResponseSchema (booleans, no traceId)
  - module imports cleanly WITHOUT --extra realtime (no livekit-agents in graph)
"""
from __future__ import annotations

import socket
import time
from contextlib import closing
from typing import Generator
from unittest.mock import patch

import httpx
import pytest

from agent import health


# Local probe client: trust_env=False bypasses HTTP_PROXY / HTTPS_PROXY env
# vars that might be configured for the test runner (urllib honors them and
# would route a 127.0.0.1 request through a proxy that returns 502).
_LOCAL_CLIENT = httpx.Client(trust_env=False, timeout=2.0)


# ---------- prestop ----------


def test_is_shutting_down_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MERISM_PRESTOP_MARKER_FILE", raising=False)
    assert health.is_shutting_down() is False
    assert health.get_prestop_marker_path() is None


def test_is_shutting_down_file_missing(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    marker = tmp_path / "marker"
    monkeypatch.setenv("MERISM_PRESTOP_MARKER_FILE", str(marker))
    assert not marker.exists()
    assert health.is_shutting_down() is False


def test_is_shutting_down_file_present(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    marker = tmp_path / "marker"
    marker.write_text("draining\n")
    monkeypatch.setenv("MERISM_PRESTOP_MARKER_FILE", str(marker))
    assert health.is_shutting_down() is True


def test_write_prestop_marker_creates_file(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    marker = tmp_path / "marker"
    monkeypatch.setenv("MERISM_PRESTOP_MARKER_FILE", str(marker))
    written = health.write_prestop_marker()
    assert written == str(marker)
    assert marker.exists()
    assert marker.read_text().startswith("draining")


def test_write_prestop_marker_noop_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MERISM_PRESTOP_MARKER_FILE", raising=False)
    assert health.write_prestop_marker() is None


def test_default_prestop_marker_matches_web_side() -> None:
    """Both web and agent honor the same default path so a single k8s manifest works."""
    assert health.DEFAULT_PRESTOP_MARKER == "/tmp/merism.prestop"


def test_resolve_health_port_defaults_to_local_safe_port() -> None:
    assert health.resolve_health_port({}) == 8082


def test_resolve_health_port_honors_env_override() -> None:
    assert health.resolve_health_port({"HEALTH_PORT": "9090"}) == 9090


# ---------- readiness check helpers ----------


def test_ping_appwrite_no_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APPWRITE_ENDPOINT", raising=False)
    assert health._ping_appwrite() is False


def test_ping_appwrite_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPWRITE_ENDPOINT", "http://fake.appwrite.test")

    class _OkResp:
        status_code = 200

    with patch.object(httpx, "get", return_value=_OkResp()):
        assert health._ping_appwrite() is True


def test_ping_appwrite_500(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPWRITE_ENDPOINT", "http://fake.appwrite.test")

    class _ErrResp:
        status_code = 503

    with patch.object(httpx, "get", return_value=_ErrResp()):
        assert health._ping_appwrite() is False


def test_ping_appwrite_network_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPWRITE_ENDPOINT", "http://fake.appwrite.test")
    with patch.object(httpx, "get", side_effect=httpx.ConnectError("refused")):
        assert health._ping_appwrite() is False


def test_check_livekit_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LIVEKIT_URL", raising=False)
    assert health._check_livekit_configured() is False
    monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
    assert health._check_livekit_configured() is True


def test_check_providers_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("MERISM_GEMINI_LIVE", raising=False)
    assert health._check_providers_configured() is False
    monkeypatch.setenv("QWEN_API_KEY", "k")
    assert health._check_providers_configured() is True
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.setenv("MERISM_GEMINI_LIVE", "1")
    assert health._check_providers_configured() is False
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    assert health._check_providers_configured() is True
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "g")
    assert health._check_providers_configured() is True


def test_run_readiness_checks_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APPWRITE_ENDPOINT", "http://fake")
    monkeypatch.setenv("LIVEKIT_URL", "wss://fake")
    monkeypatch.setenv("QWEN_API_KEY", "k")

    class _OkResp:
        status_code = 200

    with patch.object(httpx, "get", return_value=_OkResp()):
        result = health.run_readiness_checks()
    assert set(result.keys()) == {"appwrite", "livekit", "providers"}
    assert all(isinstance(v, bool) for v in result.values())
    # No traceId / extras
    assert "traceId" not in result


# ---------- HTTP server integration ----------


@pytest.fixture
def free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def health_server(free_port: int) -> Generator[int, None, None]:
    server = health.start_health_server(port=free_port)
    # give the daemon thread a moment to bind
    time.sleep(0.05)
    try:
        yield free_port
    finally:
        server.shutdown()
        server.server_close()


def _get(port: int, path: str) -> tuple[int, dict]:
    r = _LOCAL_CLIENT.get(f"http://127.0.0.1:{port}{path}")
    return r.status_code, r.json()


def test_livez_always_200(health_server: int) -> None:
    status, body = _get(health_server, "/_livez")
    assert status == 200
    assert body == {"http": True}
    assert "traceId" not in body


def test_readyz_prestop_short_circuit(
    monkeypatch: pytest.MonkeyPatch,
    health_server: int,
    tmp_path,
) -> None:
    marker = tmp_path / "marker"
    marker.write_text("draining")
    monkeypatch.setenv("MERISM_PRESTOP_MARKER_FILE", str(marker))
    status, body = _get(health_server, "/_readyz")
    assert status == 503
    assert body == {"shutting_down": True}


def test_readyz_503_on_dep_failure(
    monkeypatch: pytest.MonkeyPatch,
    health_server: int,
) -> None:
    monkeypatch.delenv("MERISM_PRESTOP_MARKER_FILE", raising=False)
    monkeypatch.delenv("APPWRITE_ENDPOINT", raising=False)
    monkeypatch.delenv("LIVEKIT_URL", raising=False)
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    status, body = _get(health_server, "/_readyz")
    assert status == 503
    # All checks present and all false
    assert body == {"appwrite": False, "livekit": False, "providers": False}


def test_readyz_200_all_healthy(
    monkeypatch: pytest.MonkeyPatch,
    health_server: int,
) -> None:
    monkeypatch.delenv("MERISM_PRESTOP_MARKER_FILE", raising=False)
    monkeypatch.setenv("APPWRITE_ENDPOINT", "http://fake")
    monkeypatch.setenv("LIVEKIT_URL", "wss://fake")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "k")

    class _OkResp:
        status_code = 200

    with patch.object(httpx, "get", return_value=_OkResp()):
        status, body = _get(health_server, "/_readyz")
    assert status == 200
    assert body == {"appwrite": True, "livekit": True, "providers": True}
    assert "traceId" not in body


def test_health_module_imports_without_realtime_extra() -> None:
    """The health module must not pull in livekit-agents — `pnpm test:py`
    runs without `uv sync --extra realtime`."""
    # If this test runs at all, the module imported fine in test collection.
    # Belt-and-braces: verify no livekit symbols leaked into module globals.
    forbidden = ("livekit", "WorkerOptions", "JobContext", "AgentSession")
    for name in forbidden:
        assert name not in dir(health), f"agent.health must not export {name}"
