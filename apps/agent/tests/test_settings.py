from agent.settings import prepare_google_plugin_environment, resolve_gemini_settings


def test_resolve_gemini_settings_requires_a_server_side_key_and_enables_video() -> None:
    try:
        resolve_gemini_settings({})
    except ValueError as error:
        assert "GEMINI_LIVE_API_KEY or GOOGLE_API_KEY" in str(error)
    else:
        raise AssertionError("a missing Gemini key must fail closed")

    settings = resolve_gemini_settings({"GEMINI_LIVE_API_KEY": "test-key"})

    assert settings.api_key == "test-key"
    assert settings.model == "gemini-2.5-flash-native-audio-preview-12-2025"
    assert settings.base_url == "https://generativelanguage.googleapis.com"
    assert settings.video_input is True


def test_live_key_isolated_from_the_aihubmix_visual_key() -> None:
    environment = {
        "GEMINI_API_KEY": "aihubmix-visual-key",
        "GEMINI_LIVE_API_KEY": "live-key",
        "GOOGLE_API_KEY": "other-key",
        "GEMINI_LIVE_BASE_URL": "https://generativelanguage.googleapis.com",
    }

    settings = resolve_gemini_settings(environment)
    prepare_google_plugin_environment(environment, settings)

    assert settings.api_key == "live-key"
    assert settings.base_url == "https://generativelanguage.googleapis.com"
    assert environment["GEMINI_API_KEY"] == "aihubmix-visual-key"
    assert "GOOGLE_API_KEY" not in environment
