"""Unit tests for provider settings resolution and speech backend strategy.

No livekit / network imports here -- only the pure configuration layer is
exercised so these stay runnable without the ``realtime`` extra.
"""
from __future__ import annotations

import pytest

from agent.providers.qwen import DEFAULT_SPEECH_BACKEND, resolve_speech_backend
from agent.providers.settings import (
    DEFAULT_GEMINI_LANGUAGE,
    DEFAULT_GEMINI_REALTIME_MODEL,
    DEFAULT_QWEN_BASE_URL,
    DEFAULT_QWEN_VL_MODEL,
    ProviderConfigError,
    gemini_live_enabled,
    provider_settings_available,
    resolve_gemini_settings,
    resolve_llm_settings,
    resolve_provider_settings,
    resolve_speech_settings,
)


# -- LLM resolution (Qwen-VL) -----------------------------------------------


def test_resolve_llm_settings_uses_defaults():
    settings = resolve_llm_settings({"DASHSCOPE_API_KEY": "dk"})
    assert settings.api_key == "dk"
    assert settings.base_url == DEFAULT_QWEN_BASE_URL
    assert settings.model == DEFAULT_QWEN_VL_MODEL


def test_resolve_llm_settings_accepts_qwen_key_alias():
    settings = resolve_llm_settings({"QWEN_API_KEY": "qk"})
    assert settings.api_key == "qk"
    assert settings.model == DEFAULT_QWEN_VL_MODEL


def test_resolve_llm_settings_qwen_vl_model_env_override():
    settings = resolve_llm_settings({"DASHSCOPE_API_KEY": "dk", "QWEN_VL_MODEL": "qwen-vl-max"})
    assert settings.model == "qwen-vl-max"


def test_resolve_llm_settings_requires_key():
    with pytest.raises(ProviderConfigError):
        resolve_llm_settings({})


# -- Speech resolution (Qwen ASR/TTS) ---------------------------------------


def test_resolve_speech_settings_accepts_dashscope_alias():
    settings = resolve_speech_settings({"DASHSCOPE_API_KEY": "qk"})
    assert settings.api_key == "qk"
    assert settings.base_url == DEFAULT_QWEN_BASE_URL
    assert settings.language == "zh"


def test_resolve_speech_settings_requires_key():
    with pytest.raises(ProviderConfigError):
        resolve_speech_settings({})


# -- Combined resolution (default cascade mode) -----------------------------


def test_resolve_provider_settings_combines_both():
    env = {"DASHSCOPE_API_KEY": "dk", "INTERVIEW_LANGUAGE": "en"}
    settings = resolve_provider_settings(env)
    assert settings.llm is not None and settings.llm.api_key == "dk"
    assert settings.llm.model == DEFAULT_QWEN_VL_MODEL
    assert settings.speech is not None and settings.speech.api_key == "dk"
    assert settings.speech.language == "en"
    assert settings.gemini is None


def test_provider_settings_available_is_false_without_credentials():
    assert provider_settings_available({}) is False
    assert provider_settings_available({"DASHSCOPE_API_KEY": "dk"}) is True
    assert provider_settings_available({"QWEN_API_KEY": "qk"}) is True


# -- Speech backend strategy ------------------------------------------------


def test_resolve_speech_backend_defaults_and_validates():
    assert resolve_speech_backend({}) == DEFAULT_SPEECH_BACKEND
    assert resolve_speech_backend({"QWEN_SPEECH_BACKEND": "openai"}) == "openai"
    assert resolve_speech_backend({"QWEN_SPEECH_BACKEND": "dashscope"}) == DEFAULT_SPEECH_BACKEND
    assert resolve_speech_backend({"QWEN_SPEECH_BACKEND": "bogus"}) == DEFAULT_SPEECH_BACKEND


# -- Gemini Live realtime mode (ADR-0007) ----------------------------------


def test_gemini_live_enabled_strict_literal():
    assert gemini_live_enabled({}) is False
    assert gemini_live_enabled({"MERISM_GEMINI_LIVE": "0"}) is False
    assert gemini_live_enabled({"MERISM_GEMINI_LIVE": "true"}) is False
    assert gemini_live_enabled({"MERISM_GEMINI_LIVE": "1"}) is True


def test_resolve_gemini_settings_defaults_and_key_aliases():
    s = resolve_gemini_settings({"GOOGLE_API_KEY": "gk"})
    assert s.api_key == "gk"
    assert s.model == DEFAULT_GEMINI_REALTIME_MODEL
    assert s.language == DEFAULT_GEMINI_LANGUAGE
    assert s.base_url is None and s.cf_aig_token is None


def test_resolve_gemini_settings_proxy_and_overrides():
    s = resolve_gemini_settings(
        {
            "GEMINI_API_KEY": "gk",
            "GEMINI_REALTIME_MODEL": "gemini-live-2.5-flash-preview",
            "GEMINI_BASE_URL": "https://gateway.example/google-ai-studio",
            "CF_AIG_TOKEN": "cf",
        }
    )
    assert s.model == "gemini-live-2.5-flash-preview"
    assert s.base_url == "https://gateway.example/google-ai-studio"
    assert s.cf_aig_token == "cf"


def test_resolve_gemini_settings_requires_key():
    with pytest.raises(ProviderConfigError):
        resolve_gemini_settings({})


def test_resolve_provider_settings_gemini_mode():
    env = {"MERISM_GEMINI_LIVE": "1", "GEMINI_API_KEY": "gk"}
    settings = resolve_provider_settings(env)
    assert settings.llm is None
    assert settings.speech is None
    assert settings.gemini is not None and settings.gemini.api_key == "gk"


def test_provider_settings_available_per_mode():
    # default cascade mode needs DashScope key (LLM + speech share same key)
    assert provider_settings_available({"DASHSCOPE_API_KEY": "dk"}) is True
    # Gemini mode only needs Gemini key — no Qwen key required
    assert (
        provider_settings_available(
            {"MERISM_GEMINI_LIVE": "1", "GEMINI_API_KEY": "gk"}
        )
        is True
    )
    # Gemini mode without Gemini key is unavailable
    assert (
        provider_settings_available({"MERISM_GEMINI_LIVE": "1", "DASHSCOPE_API_KEY": "dk"})
        is False
    )
