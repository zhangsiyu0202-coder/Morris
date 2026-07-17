"""Official Python LiveKit + Gemini Live session construction."""
from __future__ import annotations

from livekit.agents import AgentSession
from livekit.agents.voice.room_io import RoomOptions
from livekit.plugins import google
from google.genai import types

from agent.settings import GeminiSettings


def build_gemini_session(
    settings: GeminiSettings, *, instructions: str = ""
) -> tuple[AgentSession, RoomOptions]:
    """Create one native-audio Gemini Live session with camera/screen input.

    LiveKit's Python RoomOptions forwards the most recently published camera
    or screen-share video track to the Google realtime plugin. Gemini receives
    those sampled JPEG frames on the same realtime session as participant audio.
    """
    model = google.realtime.RealtimeModel(
        model=settings.model,
        api_key=settings.api_key,
        http_options=types.HttpOptions(baseUrl=settings.base_url),
        instructions=instructions or None,
        modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # FlowRunner uses one private function tool for bounded decisions.
        # Its acknowledgement must release Gemini's function-call turn without
        # scheduling a respondent-facing follow-up generation.
        tool_behavior=types.Behavior.NON_BLOCKING,
        tool_response_scheduling=types.FunctionResponseScheduling.SILENT,
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow(),
        ),
    )
    return AgentSession(llm=model), RoomOptions(video_input=settings.video_input)
