"""Pure Gemini Live configuration for the Python interview worker."""
from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass


DEFAULT_GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"


@dataclass(frozen=True)
class GeminiSettings:
    api_key: str
    model: str
    video_input: bool = True


def resolve_gemini_settings(environment: Mapping[str, str]) -> GeminiSettings:
    """Resolve server-only Gemini credentials and the video-capable Live model."""
    api_key = environment.get("GEMINI_API_KEY") or environment.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY is required")
    return GeminiSettings(
        api_key=api_key,
        model=environment.get("GEMINI_LIVE_MODEL", DEFAULT_GEMINI_LIVE_MODEL),
    )


def prepare_google_plugin_environment(
    environment: MutableMapping[str, str], settings: GeminiSettings
) -> None:
    """Prevent google-genai from silently overriding the selected Gemini key.

    The LiveKit plugin receives ``settings.api_key`` explicitly, but its
    google-genai client also inspects process variables. With both aliases
    present that client selects ``GOOGLE_API_KEY``. Remove only the competing
    alias when ``GEMINI_API_KEY`` was the selected value, never logging either
    credential.
    """
    if environment.get("GEMINI_API_KEY") == settings.api_key:
        environment.pop("GOOGLE_API_KEY", None)
