"""Tests for the agent worker entrypoint helpers."""
from __future__ import annotations

import sys
import types

import pytest


class _FakeProc:
    def __init__(self) -> None:
        self.userdata: dict[str, object] = {}


def test_prewarm_skips_vad_in_gemini_mode(monkeypatch):
    """Gemini Live mode uses server-side turn detection (no local VAD), so
    prewarm must not load silero weights for nothing. This path returns before
    importing silero, so it runs without the realtime extra."""
    from agent.main import prewarm

    monkeypatch.setenv("MERISM_GEMINI_LIVE", "1")
    proc = _FakeProc()

    prewarm(proc)

    assert "vad" not in proc.userdata


def test_prewarm_loads_vad_for_cascade_mode(monkeypatch):
    """Default cascade mode prewarms the silero VAD into proc.userdata so the
    per-session load is off the interview hot path. Gated on the realtime extra."""
    pytest.importorskip("livekit.plugins.silero", reason="realtime extra not installed")
    from agent.main import prewarm

    monkeypatch.delenv("MERISM_GEMINI_LIVE", raising=False)
    proc = _FakeProc()

    prewarm(proc)

    assert proc.userdata.get("vad") is not None


def test_main_disables_http_proxy_for_worker(monkeypatch) -> None:
    from agent import main as agent_main

    captured: dict[str, object] = {}

    class _FakeWorkerOptions:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    fake_cli = types.SimpleNamespace(run_app=lambda options: captured.setdefault("options", options))
    fake_agents = types.ModuleType("livekit.agents")
    fake_agents.WorkerOptions = _FakeWorkerOptions
    fake_agents.cli = fake_cli
    fake_livekit = types.ModuleType("livekit")
    fake_livekit.agents = fake_agents

    monkeypatch.setitem(sys.modules, "livekit", fake_livekit)
    monkeypatch.setitem(sys.modules, "livekit.agents", fake_agents)
    monkeypatch.setattr(agent_main, "start_health_server", lambda: None)
    monkeypatch.setattr(agent_main, "_install_drain_handler", lambda: None)

    agent_main.main()

    assert captured["entrypoint_fnc"] is agent_main.entrypoint
    assert captured["prewarm_fnc"] is agent_main.prewarm
    assert captured["http_proxy"] is None
