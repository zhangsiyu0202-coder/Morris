"""Unit tests for provider settings resolution and speech backend strategy.

No livekit / network imports here -- only the pure configuration layer is
exercised so these stay runnable without the ``realtime`` extra.
"""
from __future__ import annotations

import pytest

from agent.providers.qwen import DEFAULT_SPEECH_BACKEND, resolve_speech_backend
from agent.providers.settings import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_GEMINI_LANGUAGE,
    DEFAULT_GEMINI_REALTIME_MODEL,
    DEFAULT_QWEN_BASE_URL,
    ProviderConfigError,
    gemini_live_enabled,
    provider_settings_available,
    resolve_gemini_settings,
    resolve_llm_settings,
    resolve_provider_settings,
    resolve_speech_settings,
)


def test_resolve_llm_settings_uses_defaults():
    settings = resolve_llm_settings({"DEEPSEEK_API_KEY": "dk"})
    assert settings.api_key == "dk"
    assert settings.base_url == DEFAULT_DEEPSEEK_BASE_URL
    assert settings.model == "deepseek-chat"


def test_resolve_llm_settings_requires_key():
    with pytest.raises(ProviderConfigError):
        resolve_llm_settings({})


def test_resolve_speech_settings_accepts_dashscope_alias():
    settings = resolve_speech_settings({"DASHSCOPE_API_KEY": "qk"})
    assert settings.api_key == "qk"
    assert settings.base_url == DEFAULT_QWEN_BASE_URL
    assert settings.language == "zh"


def test_resolve_speech_settings_requires_key():
    with pytest.raises(ProviderConfigError):
        resolve_speech_settings({})


def test_resolve_provider_settings_combines_both():
    env = {"DEEPSEEK_API_KEY": "dk", "QWEN_API_KEY": "qk", "INTERVIEW_LANGUAGE": "en"}
    settings = resolve_provider_settings(env)
    assert settings.llm.api_key == "dk"
    assert settings.speech.api_key == "qk"
    assert settings.speech.language == "en"


def test_provider_settings_available_is_false_without_credentials():
    assert provider_settings_available({}) is False
    assert provider_settings_available({"DEEPSEEK_API_KEY": "dk"}) is False
    assert provider_settings_available({"DEEPSEEK_API_KEY": "dk", "QWEN_API_KEY": "qk"}) is True


def test_resolve_speech_backend_defaults_and_validates():
    assert resolve_speech_backend({}) == DEFAULT_SPEECH_BACKEND
    assert resolve_speech_backend({"QWEN_SPEECH_BACKEND": "dashscope"}) == "dashscope"
    # invalid value falls back to default rather than raising
    assert resolve_speech_backend({"QWEN_SPEECH_BACKEND": "bogus"}) == DEFAULT_SPEECH_BACKEND


# --- Gemini Live realtime mode (ADR-0007) ----------------------------------


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
    env = {"MERISM_GEMINI_LIVE": "1", "GEMINI_API_KEY": "gk", "QWEN_API_KEY": "qk"}
    settings = resolve_provider_settings(env)
    # Gemini mode: DeepSeek LLM not required, Qwen speech still resolved (TTS).
    assert settings.llm is None
    assert settings.gemini is not None and settings.gemini.api_key == "gk"
    assert settings.speech.api_key == "qk"


def test_provider_settings_available_per_mode():
    # default mode needs DeepSeek + Qwen
    assert provider_settings_available({"DEEPSEEK_API_KEY": "dk", "QWEN_API_KEY": "qk"}) is True
    # gemini mode needs Gemini + Qwen (not DeepSeek)
    assert (
        provider_settings_available(
            {"MERISM_GEMINI_LIVE": "1", "GEMINI_API_KEY": "gk", "QWEN_API_KEY": "qk"}
        )
        is True
    )
    # gemini mode without the Gemini key is unavailable
    assert provider_settings_available({"MERISM_GEMINI_LIVE": "1", "QWEN_API_KEY": "qk"}) is False
