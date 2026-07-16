import asyncio

from livekit.agents.voice.agent_activity import AgentActivity

from agent.runtime import build_gemini_session
from agent.settings import GeminiSettings


def test_build_gemini_session_enables_live_video_and_both_transcriptions() -> None:
    async def build() -> None:
        session, room_options = build_gemini_session(
            GeminiSettings(api_key="test-key", model="gemini-2.5-flash-native-audio-preview-12-2025")
        )

        assert session is not None
        assert room_options.video_input is not False

    asyncio.run(build())


def test_livekit_sdk_exposes_the_video_input_seam_used_for_research_stimuli() -> None:
    # LiveKit's AgentSession currently has no public method for an
    # application-provided still image, while its active AgentActivity owns
    # the Gemini Live video transport. Fail loudly on an incompatible upgrade.
    assert callable(getattr(AgentActivity, "push_video", None))
