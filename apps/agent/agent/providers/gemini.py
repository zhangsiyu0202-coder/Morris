"""Gemini Live realtime adapter (ADR-0007).

Builds a ``livekit.plugins.google`` realtime model used as the AgentSession
``llm`` when ``MERISM_GEMINI_LIVE=1``. It runs in **AUDIO modality** — Gemini
Live is the full pipeline (ASR + understanding + audio response), so no
external TTS is wired into the AgentSession. Both speakers' transcripts are
still captured via Live's ``input_audio_transcription`` (interviewee speech)
and ``output_audio_transcription`` (model speech), which keeps the
``conversation_item_added`` events flowing into the transcript collector
unchanged.

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
        # AUDIO modality: Gemini Live emits speech directly. No external TTS
        # in the AgentSession (see engine._build_session).
        "modalities": ["AUDIO"],
        # NOTE: native-audio Live models reject explicit language codes (1007
        # "Unsupported language code 'cmn-CN'"); per Google's live-guide,
        # "Native audio output models automatically choose the appropriate
        # language and don't support explicitly setting the language code."
        # The supervisor system_instruction already pins the conversation to
        # Mandarin via the researchGoal / introScript / per-question prompt,
        # so the model will speak Chinese without this kwarg.
        "api_key": settings.api_key,
        # Capture both sides of the conversation as text. Without these the
        # transcript collector would never see ``conversation_item_added``
        # events with text payloads and the analysis pipeline (transcript
        # persistence + AnalysisReport citations) would have nothing to anchor.
        # NOTE: AudioTranscriptionConfig.language_codes IS the right knob to
        # pin Simplified Chinese, but the Live API rejects it in AI Studio
        # mode with "language_codes parameter is only supported in Gemini
        # Enterprise Agent Platform mode" (Vertex AI). For now we accept that
        # zh defaults to Traditional output here and normalize downstream
        # (see TranscriptCollector / OpenCC). Switching to Vertex AI auth
        # would unblock this kwarg but is a larger infra change.
        "input_audio_transcription": types.AudioTranscriptionConfig(),
        "output_audio_transcription": types.AudioTranscriptionConfig(),
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
    """Construct a Gemini Live ``RealtimeModel`` (AUDIO out). Requires the
    ``realtime`` extra (``uv sync --extra realtime``)."""
    from livekit.plugins import google

    return google.beta.realtime.RealtimeModel(**_realtime_kwargs(settings))
