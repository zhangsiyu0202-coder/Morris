"""Gemini Live realtime adapter (ADR-0007).

Builds a ``livekit.plugins.google`` realtime model used as the AgentSession
``llm`` when ``MERISM_GEMINI_LIVE=1``. It runs in TEXT modality — Gemini Live is
the ears + brain (ASR + understanding + response text) and an external TTS
(Qwen) speaks — so the existing transcript/quality pipeline and the question
TaskGroup are unchanged.

When ``base_url`` is set the google genai client is pointed at a proxy (e.g. a
Cloudflare AI Gateway, which supports the Gemini Live WebSocket API); the Live
WebSocket endpoint is derived from it. All livekit / google imports are lazy so
this module stays importable without the ``realtime`` extra.
"""
from __future__ import annotations

from typing import Any

from agent.providers.settings import GeminiSettings


def _realtime_kwargs(settings: GeminiSettings) -> dict[str, Any]:
    """Build the ``RealtimeModel`` kwargs.

    Kept separate from the model construction so the session-management config
    is unit-testable: this only needs ``google.genai.types`` (no livekit, no
    event loop — ``RealtimeModel.__init__`` schedules a task and so requires a
    running loop).
    """
    from google.genai import types

    kwargs: dict[str, Any] = {
        "model": settings.model,
        "modalities": ["TEXT"],
        "language": settings.language,
        "api_key": settings.api_key,
        # Explicitly enable interviewee speech->text. It defaults on, but the
        # transcript (and the whole analysis pipeline) depends on user turns
        # becoming conversation items, so we do not leave it to a default.
        "input_audio_transcription": types.AudioTranscriptionConfig(),
        # Lift Gemini Live's session duration cap: without compression an
        # audio session terminates at ~15 min, which a real interview exceeds.
        # A sliding-window compression extends the session to unlimited length.
        # Session *resumption* (surviving the ~10-min connection GoAway) is
        # intentionally NOT set here: the livekit google plugin already captures
        # the resumption handle from server updates and reuses it on every
        # reconnect, so within one interview it is auto-managed.
        "context_window_compression": types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(),
        ),
    }

    if settings.base_url:
        headers = (
            {"cf-aig-authorization": f"Bearer {settings.cf_aig_token}"}
            if settings.cf_aig_token
            else None
        )
        kwargs["http_options"] = types.HttpOptions(base_url=settings.base_url, headers=headers)

    return kwargs


def build_realtime_llm(settings: GeminiSettings) -> Any:
    """Construct a Gemini Live ``RealtimeModel`` (TEXT out). Requires the
    ``realtime`` extra (``uv sync --extra realtime``)."""
    from livekit.plugins import google

    return google.beta.realtime.RealtimeModel(**_realtime_kwargs(settings))
