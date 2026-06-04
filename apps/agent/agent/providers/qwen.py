"""Qwen ASR / TTS adapters (via DashScope OpenAI-compatible endpoints).

The livekit ``openai`` plugin's STT/TTS classes are pointed at DashScope's
OpenAI-compatible gateway so we get Qwen speech models without a bespoke
plugin. Imports are lazy so the package stays importable without the
``realtime`` extra.
"""
from __future__ import annotations

from typing import Any

from agent.providers.settings import SpeechSettings


def build_stt(settings: SpeechSettings) -> Any:
    """Construct a livekit STT bound to Qwen ASR.

    Returns a ``livekit.plugins.openai.STT`` instance. Requires the
    ``realtime`` extra.
    """
    from livekit.plugins import openai

    return openai.STT(
        model=settings.asr_model,
        api_key=settings.api_key,
        base_url=settings.base_url,
        language=settings.language,
    )


def build_tts(settings: SpeechSettings) -> Any:
    """Construct a livekit TTS bound to Qwen TTS.

    Returns a ``livekit.plugins.openai.TTS`` instance. Requires the
    ``realtime`` extra.
    """
    from livekit.plugins import openai

    return openai.TTS(
        model=settings.tts_model,
        voice=settings.tts_voice,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )
