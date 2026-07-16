from agent.settings import prepare_google_plugin_environment, resolve_gemini_settings


def test_resolve_gemini_settings_requires_a_server_side_key_and_enables_video() -> None:
    try:
        resolve_gemini_settings({})
    except ValueError as error:
        assert "GEMINI_API_KEY or GOOGLE_API_KEY" in str(error)
    else:
        raise AssertionError("a missing Gemini key must fail closed")

    settings = resolve_gemini_settings({"GEMINI_API_KEY": "test-key"})

    assert settings.api_key == "test-key"
    assert settings.model == "gemini-2.5-flash-native-audio-preview-12-2025"
    assert settings.video_input is True


def test_gemini_key_wins_when_the_process_has_both_google_key_names() -> None:
    environment = {"GEMINI_API_KEY": "gemini-key", "GOOGLE_API_KEY": "other-key"}

    settings = resolve_gemini_settings(environment)
    prepare_google_plugin_environment(environment, settings)

    assert settings.api_key == "gemini-key"
    assert environment == {"GEMINI_API_KEY": "gemini-key"}
