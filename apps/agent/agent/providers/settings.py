"""Pure, testable resolution of provider configuration from the environment.

No SDK / network imports here so it stays unit-testable without the realtime
extra. The actual plugin construction lives in ``deepseek.py`` / ``qwen.py`` and
lazily imports ``livekit.plugins``.

Providers (per design.md §AI 服务):
- DeepSeek  ->全站 LLM（访谈推进与 task result 归纳），OpenAI 兼容协议。
- Qwen      -> 实时 ASR / TTS，走 DashScope 的 OpenAI 兼容端点。
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

# --- Defaults ---------------------------------------------------------------

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"

# DashScope exposes an OpenAI-compatible gateway; Qwen ASR/TTS models are
# addressed through it so the existing livekit openai plugin can be reused.
DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_QWEN_ASR_MODEL = "paraformer-realtime-v2"
DEFAULT_QWEN_TTS_MODEL = "cosyvoice-v1"
DEFAULT_QWEN_TTS_VOICE = "longxiaochun"
DEFAULT_LANGUAGE = "zh"


class ProviderConfigError(ValueError):
    """Raised when a required provider credential is missing."""


@dataclass(frozen=True)
class LLMSettings:
    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True)
class SpeechSettings:
    api_key: str
    base_url: str
    asr_model: str
    tts_model: str
    tts_voice: str
    language: str


@dataclass(frozen=True)
class ProviderSettings:
    llm: LLMSettings
    speech: SpeechSettings


def _first(env: Mapping[str, str], *keys: str, default: str | None = None) -> str | None:
    for key in keys:
        value = env.get(key)
        if value:
            return value
    return default


def resolve_llm_settings(env: Mapping[str, str]) -> LLMSettings:
    """Resolve DeepSeek LLM settings; raises if the API key is absent."""
    api_key = _first(env, "DEEPSEEK_API_KEY")
    if not api_key:
        raise ProviderConfigError("DEEPSEEK_API_KEY is required for the interview LLM")
    return LLMSettings(
        api_key=api_key,
        base_url=_first(env, "DEEPSEEK_BASE_URL", default=DEFAULT_DEEPSEEK_BASE_URL),
        model=_first(env, "DEEPSEEK_MODEL", default=DEFAULT_DEEPSEEK_MODEL),
    )


def resolve_speech_settings(env: Mapping[str, str]) -> SpeechSettings:
    """Resolve Qwen ASR/TTS settings; raises if the API key is absent."""
    api_key = _first(env, "QWEN_API_KEY", "DASHSCOPE_API_KEY", "STT_PROVIDER_KEY", "TTS_PROVIDER_KEY")
    if not api_key:
        raise ProviderConfigError("QWEN_API_KEY (or DASHSCOPE_API_KEY) is required for ASR/TTS")
    return SpeechSettings(
        api_key=api_key,
        base_url=_first(env, "QWEN_BASE_URL", "DASHSCOPE_BASE_URL", default=DEFAULT_QWEN_BASE_URL),
        asr_model=_first(env, "QWEN_ASR_MODEL", default=DEFAULT_QWEN_ASR_MODEL),
        tts_model=_first(env, "QWEN_TTS_MODEL", default=DEFAULT_QWEN_TTS_MODEL),
        tts_voice=_first(env, "QWEN_TTS_VOICE", default=DEFAULT_QWEN_TTS_VOICE),
        language=_first(env, "QWEN_LANGUAGE", "INTERVIEW_LANGUAGE", default=DEFAULT_LANGUAGE),
    )


def resolve_provider_settings(env: Mapping[str, str] | None = None) -> ProviderSettings:
    """Resolve both LLM and speech settings; raises on any missing credential."""
    resolved = os.environ if env is None else env
    return ProviderSettings(
        llm=resolve_llm_settings(resolved),
        speech=resolve_speech_settings(resolved),
    )


def provider_settings_available(env: Mapping[str, str] | None = None) -> bool:
    """Return whether both LLM and speech credentials are present (never raises).

    main.py uses this to decide between the full voice engine and the UI-only
    RPC bridge fallback.
    """
    resolved = os.environ if env is None else env
    try:
        resolve_provider_settings(resolved)
    except ProviderConfigError:
        return False
    return True
