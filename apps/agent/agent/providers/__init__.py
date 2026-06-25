"""External AI provider adapters: Qwen-VL (LLM) + Qwen (ASR/TTS), with an
opt-in Gemini Live realtime mode (ADR-0007). DeepSeek is kept dormant in
``deepseek.py`` for easy revert (see ADR-0011 TODO).

Pure configuration resolution lives in ``settings`` and is import-safe without
the ``realtime`` extra. The ``build_*`` factories lazily import livekit plugins
and select a pluggable speech backend, so the engine and its tests only depend
on stable interfaces.
"""
from agent.providers.qwen_llm import build_llm
from agent.providers.gemini import build_realtime_llm
from agent.providers.qwen import (
    DEFAULT_SPEECH_BACKEND,
    SpeechBackend,
    build_stt,
    build_tts,
    resolve_speech_backend,
)
from agent.providers.settings import (
    GeminiSettings,
    LLMSettings,
    ProviderConfigError,
    ProviderSettings,
    SpeechSettings,
    gemini_live_enabled,
    provider_settings_available,
    resolve_gemini_settings,
    resolve_llm_settings,
    resolve_provider_settings,
    resolve_speech_settings,
)

__all__ = [
    # settings
    "LLMSettings",
    "SpeechSettings",
    "GeminiSettings",
    "ProviderSettings",
    "ProviderConfigError",
    "resolve_llm_settings",
    "resolve_speech_settings",
    "resolve_gemini_settings",
    "resolve_provider_settings",
    "gemini_live_enabled",
    "provider_settings_available",
    # factories
    "build_llm",
    "build_realtime_llm",
    "build_stt",
    "build_tts",
    # speech backend strategy
    "SpeechBackend",
    "DEFAULT_SPEECH_BACKEND",
    "resolve_speech_backend",
]
