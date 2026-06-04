"""External AI provider adapters: DeepSeek (LLM) + Qwen (ASR/TTS).

Pure configuration resolution lives in ``settings`` and is import-safe without
the ``realtime`` extra; the ``build_*`` factories lazily import livekit plugins.
"""
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
    "LLMSettings",
    "SpeechSettings",
    "ProviderSettings",
    "ProviderConfigError",
    "resolve_llm_settings",
    "resolve_speech_settings",
    "resolve_provider_settings",
    "provider_settings_available",
]
