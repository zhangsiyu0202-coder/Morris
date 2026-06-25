"""Pure, testable resolution of provider configuration from the environment.

No SDK / network imports here so it stays unit-testable without the realtime
extra. The actual plugin construction lives in ``qwen_llm.py`` / ``qwen.py`` and
lazily imports ``livekit.plugins``.

Providers (per design.md §AI 服务):
- Qwen-VL   -> 全站 cascade LLM（访谈推进与 task result 归纳），多模态
              (text+image)，通过 DashScope 的 OpenAI 兼容端点访问。
- DeepSeek  -> dormant 保留在 ``deepseek.py`` 以便回退（由架构规则
              ``architecture.md`` 要求保持，见 ADR-0011 TODO）。
- Qwen      -> 实时 ASR / TTS，复用 DashScope 同一 API key。
- Gemini    -> ADR-0007 opt-in realtime mode (MERISM_GEMINI_LIVE=1). AUDIO
              modality: Live API does ASR + LLM + TTS in one model, no external
              speech provider is wired into the realtime AgentSession.
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

# Qwen-VL multimodal model (cascade LLM). Override via QWEN_VL_MODEL env var.
DEFAULT_QWEN_VL_MODEL = "qwen3-vl-plus"

# Gemini Live realtime option (ADR-0007). Opt-in via MERISM_GEMINI_LIVE=1; when
# off the agent keeps the DeepSeek (LLM) + Qwen (ASR/TTS) cascade. The 2.5
# native-audio Live model keeps mutable_chat_context=True (unlike the 3.1
# Live preview, which disables it and would force question-task changes), so
# the existing question-task on_enter generate_reply works unchanged. Per
# Google docs (last verified 2026-06-15) the 12-2025 preview is the latest
# 2.5 Live drop; 09-2025 was deprecated 2026-03-19.
DEFAULT_GEMINI_REALTIME_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
DEFAULT_GEMINI_LANGUAGE = "cmn-CN"  # BCP-47 (Gemini Live), distinct from Qwen's "zh"


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
class GeminiSettings:
    """Gemini Live realtime settings (ADR-0007). `base_url` points the google
    genai client at a proxy (e.g. a Cloudflare AI Gateway) when set; the Live
    WebSocket endpoint is derived from it. `cf_aig_token` is the optional
    Cloudflare AI Gateway authorization."""

    api_key: str
    model: str
    language: str
    base_url: str | None = None
    cf_aig_token: str | None = None


@dataclass(frozen=True)
class ProviderSettings:
    # `llm` (Qwen-VL) is None in Gemini Live mode; `speech` (Qwen ASR/TTS) is
    # None in Gemini Live mode (Gemini Live emits audio itself, no external
    # speech provider is wired in); `gemini` is None in the default cascade mode.
    llm: LLMSettings | None
    speech: SpeechSettings | None
    gemini: GeminiSettings | None = None


def _first(env: Mapping[str, str], *keys: str, default: str | None = None) -> str | None:
    for key in keys:
        value = env.get(key)
        if value:
            return value
    return default


def resolve_llm_settings(env: Mapping[str, str]) -> LLMSettings:
    """Resolve Qwen-VL (cascade) LLM settings via DashScope; raises if the API
    key is absent. ``QWEN_API_KEY`` is accepted as a ``DASHSCOPE_API_KEY`` alias.
    The DeepSeek constants (``DEFAULT_DEEPSEEK_*``) are kept dormant for revert
    but are not read by this resolver."""
    api_key = _first(env, "DASHSCOPE_API_KEY", "QWEN_API_KEY")
    if not api_key:
        raise ProviderConfigError("DASHSCOPE_API_KEY (or QWEN_API_KEY) is required for the cascade LLM")
    return LLMSettings(
        api_key=api_key,
        base_url=_first(env, "QWEN_BASE_URL", "DASHSCOPE_BASE_URL", default=DEFAULT_QWEN_BASE_URL),
        model=_first(env, "QWEN_VL_MODEL", default=DEFAULT_QWEN_VL_MODEL),
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


def gemini_live_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Whether the realtime interview uses Gemini Live instead of DeepSeek+Qwen
    (ADR-0007). Strict literal per the steering flag convention. Unset -> off."""
    resolved = os.environ if env is None else env
    return resolved.get("MERISM_GEMINI_LIVE") == "1"


def resolve_gemini_settings(env: Mapping[str, str]) -> GeminiSettings:
    """Resolve Gemini Live settings; raises if the API key is absent."""
    api_key = _first(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")
    if not api_key:
        raise ProviderConfigError(
            "GEMINI_API_KEY (or GOOGLE_API_KEY) is required when MERISM_GEMINI_LIVE=1"
        )
    return GeminiSettings(
        api_key=api_key,
        model=_first(env, "GEMINI_REALTIME_MODEL", default=DEFAULT_GEMINI_REALTIME_MODEL),
        language=_first(env, "GEMINI_LANGUAGE", "INTERVIEW_LANGUAGE", default=DEFAULT_GEMINI_LANGUAGE),
        # Optional proxy (e.g. Cloudflare AI Gateway). When unset the google
        # client talks to generativelanguage.googleapis.com directly.
        base_url=_first(env, "GEMINI_BASE_URL"),
        cf_aig_token=_first(env, "CF_AIG_TOKEN"),
    )


def resolve_provider_settings(env: Mapping[str, str] | None = None) -> ProviderSettings:
    """Resolve provider settings for the active realtime mode; raises on any
    missing credential. In Gemini Live mode only the Gemini key is required
    (Qwen speech is not resolved — Gemini Live emits audio itself). In default
    cascade mode both Qwen-VL LLM and Qwen speech credentials are required."""
    resolved = os.environ if env is None else env
    if gemini_live_enabled(resolved):
        return ProviderSettings(llm=None, speech=None, gemini=resolve_gemini_settings(resolved))
    return ProviderSettings(
        llm=resolve_llm_settings(resolved),
        speech=resolve_speech_settings(resolved),
        gemini=None,
    )


def provider_settings_available(env: Mapping[str, str] | None = None) -> bool:
    """Return whether provider credentials are present for the active mode (never
    raises). In default cascade mode both DashScope and Qwen speech are required;
    in Gemini Live mode only the Gemini key is required.

    main.py uses this to decide between the full voice engine and the UI-only
    RPC bridge fallback.
    """
    resolved = os.environ if env is None else env
    try:
        resolve_provider_settings(resolved)
    except ProviderConfigError:
        return False
    return True
