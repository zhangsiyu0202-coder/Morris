"""External AI provider adapters: DeepSeek (LLM) + Qwen (ASR/TTS).

Pure configuration resolution lives in ``settings`` and is import-safe without
the ``realtime`` extra. The ``build_*`` factories lazily import livekit plugins
and select a pluggable speech backend, so the engine and its tests only depend
on stable interfaces.
"""
from agent.providers.deepseek import build_llm
from agent.providers.qwen import (
    DEFAULT_SPEECH_BACKEND,
    SpeechBackend,
    build_stt,
    build_tts,
    resolve_speech_backend,
)
from agent.providers.settings import (
    LLMSettings,
    ProviderConfigError,
    ProviderSettings,
    SpeechSettings,
    provider_settings_available,
    resolve_llm_settings,
    resolve_provider_settings,
    resolve_speech_settings,
)

__all__ = [
    # settings
    "LLMSettings",
    "SpeechSettings",
    "ProviderSettings",
    "ProviderConfigError",
    "resolve_llm_settings",
    "resolve_speech_settings",
    "resolve_provider_settings",
    "provider_settings_available",
    # factories
    "build_llm",
    "build_stt",
    "build_tts",
    # speech backend strategy
    "SpeechBackend",
    "DEFAULT_SPEECH_BACKEND",
    "resolve_speech_backend",
]
