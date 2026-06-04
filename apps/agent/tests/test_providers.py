"""Unit tests for provider settings resolution and speech backend strategy.

No livekit / network imports here -- only the pure configuration layer is
exercised so these stay runnable without the ``realtime`` extra.
"""
from __future__ import annotations

import pytest

from agent.providers.qwen import DEFAULT_SPEECH_BACKEND, resolve_speech_backend
from agent.providers.settings import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_QWEN_BASE_URL,
    ProviderConfigError,
    provider_settings_available,
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
