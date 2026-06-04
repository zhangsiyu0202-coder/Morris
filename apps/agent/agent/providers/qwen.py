"""Qwen ASR / TTS adapters with a pluggable speech backend.

The engine only depends on the stable ``build_stt`` / ``build_tts`` factories.
*How* those are constructed is selected by a backend strategy so the concrete
implementation can be swapped without touching the engine or its tests:

- ``openai`` (default): point the livekit ``openai`` plugin's STT/TTS at
  DashScope's OpenAI-compatible gateway. No OpenAI service is involved -- the
  plugin is just a generic OpenAI-protocol client and is given Qwen/DashScope
  ``base_url`` + ``api_key``.
- ``dashscope`` (placeholder): reserved for a bespoke DashScope SDK / custom
  livekit STT/TTS wrapper if the compatible gateway proves insufficient for
  streaming speech.

Select via ``QWEN_SPEECH_BACKEND`` (``openai`` | ``dashscope``). All livekit /
SDK imports are lazy so this module stays importable without the ``realtime``
extra.
"""
from __future__ import annotations

import os
from typing import Any, Callable, Literal

from agent.providers.settings import SpeechSettings

SpeechBackend = Literal["openai", "dashscope"]

DEFAULT_SPEECH_BACKEND: SpeechBackend = "openai"


def resolve_speech_backend(env: dict[str, str] | None = None) -> SpeechBackend:
    """Resolve which speech backend to use (never raises)."""
    source = os.environ if env is None else env
    value = (source.get("QWEN_SPEECH_BACKEND") or DEFAULT_SPEECH_BACKEND).strip().lower()
    if value not in ("openai", "dashscope"):
        return DEFAULT_SPEECH_BACKEND
    return value  # type: ignore[return-value]


# --- openai-compatible backend ---------------------------------------------


def _build_stt_openai(settings: SpeechSettings) -> Any:
    from livekit.plugins import openai

    return openai.STT(
        model=settings.asr_model,
        api_key=settings.api_key,
        base_url=settings.base_url,
        language=settings.language,
    )


def _build_tts_openai(settings: SpeechSettings) -> Any:
    from livekit.plugins import openai

    return openai.TTS(
        model=settings.tts_model,
        voice=settings.tts_voice,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )


# --- dashscope backend (reserved) -------------------------------------------


def _build_stt_dashscope(settings: SpeechSettings) -> Any:  # pragma: no cover - reserved
    raise NotImplementedError(
        "DashScope-native STT backend is not implemented yet; "
        "set QWEN_SPEECH_BACKEND=openai to use the compatible gateway."
    )


def _build_tts_dashscope(settings: SpeechSettings) -> Any:  # pragma: no cover - reserved
    raise NotImplementedError(
        "DashScope-native TTS backend is not implemented yet; "
        "set QWEN_SPEECH_BACKEND=openai to use the compatible gateway."
    )


_STT_BACKENDS: dict[SpeechBackend, Callable[[SpeechSettings], Any]] = {
    "openai": _build_stt_openai,
    "dashscope": _build_stt_dashscope,
}

_TTS_BACKENDS: dict[SpeechBackend, Callable[[SpeechSettings], Any]] = {
    "openai": _build_tts_openai,
    "dashscope": _build_tts_dashscope,
}


def build_stt(settings: SpeechSettings, backend: SpeechBackend | None = None) -> Any:
    """Construct a livekit STT bound to Qwen ASR. Requires the ``realtime`` extra."""
    chosen = backend or resolve_speech_backend()
    return _STT_BACKENDS[chosen](settings)


def build_tts(settings: SpeechSettings, backend: SpeechBackend | None = None) -> Any:
    """Construct a livekit TTS bound to Qwen TTS. Requires the ``realtime`` extra."""
    chosen = backend or resolve_speech_backend()
    return _TTS_BACKENDS[chosen](settings)
