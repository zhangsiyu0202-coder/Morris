"""Qwen ASR / TTS adapters via DashScope's OpenAI-compatible gateway.

All livekit / SDK imports are lazy so this module stays importable without the
``realtime`` extra.
"""
from __future__ import annotations

from typing import Any

from agent.providers.settings import SpeechSettings

SpeechBackend = str
DEFAULT_SPEECH_BACKEND = "openai"


def resolve_speech_backend(env: dict[str, str] | None = None) -> str:
    import os

    source = os.environ if env is None else env
    value = (source.get("QWEN_SPEECH_BACKEND") or DEFAULT_SPEECH_BACKEND).strip().lower()
    if value != "openai":
        return DEFAULT_SPEECH_BACKEND
    return value


def build_stt(settings: SpeechSettings, backend: str | None = None) -> Any:
    from livekit.plugins import openai

    return openai.STT(
        model=settings.asr_model,
        api_key=settings.api_key,
        base_url=settings.base_url,
        language=settings.language,
    )


def build_tts(settings: SpeechSettings, backend: str | None = None) -> Any:
    from livekit.plugins import openai

    return openai.TTS(
        model=settings.tts_model,
        voice=settings.tts_voice,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )
