"""Pin EgressRecorder.start to dispatch ParticipantEgressRequest, not
RoomCompositeEgressRequest. Per LiveKit docs the participant variant is
the canonical 1-on-1 recording mode (server-side, no Chromium).

This test stubs ``livekit.api.LiveKitAPI`` so the lazy import inside
``start()`` finds a fake LiveKit client whose ``egress.start_participant_egress``
captures the request, then asserts the request carries:
- room_name == the room
- identity == ``interviewee:<sessionId>`` (our token issuance convention)
- screen_share == True (so any screenshare the interviewee opens is recorded)
- a single ``EncodedFileOutput`` writing to ``<output_dir>/<sessionId>.mp4``.

Crucially, we do NOT replace ``livekit.protocol.egress`` — the real
``ParticipantEgressRequest`` / ``EncodedFileOutput`` types must still
import so we can verify the shape end-to-end.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest

from agent.interview.egress_recorder import EgressRecorder, EgressSettings


def _settings() -> EgressSettings:
    return EgressSettings(
        livekit_url="ws://livekit:7880",
        api_key="k",
        api_secret="s",
        output_dir="/out",
        local_mount=None,
    )


def _logger() -> MagicMock:
    log = MagicMock()
    log.info = MagicMock()
    log.warn = MagicMock()
    return log


def test_start_uses_participant_egress(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeEgress:
        async def start_participant_egress(self, req):  # noqa: D401
            captured["request"] = req
            info = MagicMock()
            info.egress_id = "EG_test"
            return info

        async def start_room_composite_egress(self, req):  # noqa: D401
            captured["WRONG_API_CALLED"] = req
            raise AssertionError(
                "EgressRecorder.start must call start_participant_egress, "
                "not start_room_composite_egress (RoomComposite spawns a "
                "second Chromium and is not the canonical 1-on-1 mode)"
            )

    class FakeLK:
        def __init__(self) -> None:
            self.egress = FakeEgress()

    @asynccontextmanager
    async def fake_ctx(*_args, **_kwargs):  # noqa: D401
        yield FakeLK()

    # Patch only the api.LiveKitAPI factory; leave protocol.egress + types
    # alone so the real ParticipantEgressRequest is what's instantiated.
    from livekit import api as livekit_api

    monkeypatch.setattr(livekit_api, "LiveKitAPI", lambda *a, **k: fake_ctx())

    rec = EgressRecorder(_settings(), _logger())
    loop = asyncio.new_event_loop()
    try:
        ok = loop.run_until_complete(
            rec.start(room_name="s_abc_0", session_id="s_abc_0")
        )
    finally:
        loop.close()

    assert ok is True
    assert rec.egress_id == "EG_test"
    assert "WRONG_API_CALLED" not in captured

    req = captured["request"]
    assert type(req).__name__ == "ParticipantEgressRequest"
    assert req.room_name == "s_abc_0"
    assert req.identity == "interviewee:s_abc_0"
    assert req.screen_share is True
    assert len(req.file_outputs) == 1
    assert req.file_outputs[0].filepath == "/out/s_abc_0.mp4"
