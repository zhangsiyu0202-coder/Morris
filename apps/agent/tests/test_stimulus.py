import asyncio
import io

import pytest
from PIL import Image

from agent.stimulus import StimulusDeliveryError, build_stimulus_sender


class _Activity:
    def __init__(self) -> None:
        self.frames: list[object] = []

    def push_video(self, frame: object) -> None:
        self.frames.append(frame)


class _Session:
    def __init__(self) -> None:
        self._activity = _Activity()


def test_image_stimulus_is_decoded_and_pushed_to_the_active_gemini_live_session() -> None:
    async def run() -> None:
        session = _Session()

        async def load(_url: str) -> bytes:
            # A valid 1x1 PNG. The test proves the image is converted to a
            # LiveKit VideoFrame rather than merely passed as an URL string.
            output = io.BytesIO()
            Image.new("RGBA", (1, 1), (127, 127, 127, 255)).save(output, format="PNG")
            return output.getvalue()

        sender = build_stimulus_sender(
            session=session,
            appwrite_endpoint="https://appwrite.example/v1",
            appwrite_project_id="project-1",
            loader=load,
        )
        await sender.send(
            {
                "id": "stimulus-1",
                "type": "image",
                "url": "https://appwrite.example/v1/storage/buckets/survey-assets/files/file-1/view",
            }
        )

        assert len(session._activity.frames) == 1
        frame = session._activity.frames[0]
        assert frame.width == 1
        assert frame.height == 1

    asyncio.run(run())


def test_stimulus_sender_rejects_urls_outside_the_survey_assets_bucket() -> None:
    async def run() -> None:
        sender = build_stimulus_sender(
            session=_Session(),
            appwrite_endpoint="https://appwrite.example/v1",
            appwrite_project_id="project-1",
            loader=lambda _url: None,
        )
        with pytest.raises(StimulusDeliveryError, match="survey-assets"):
            await sender.send(
                {"id": "stimulus-1", "type": "image", "url": "https://evil.example/image.png"}
            )

    asyncio.run(run())


def test_non_image_stimuli_do_not_send_a_video_frame() -> None:
    async def run() -> None:
        session = _Session()
        sender = build_stimulus_sender(
            session=session,
            appwrite_endpoint="https://appwrite.example/v1",
            appwrite_project_id="project-1",
            loader=lambda _url: None,
        )
        await sender.send({"id": "text-1", "type": "text", "text": "A written stimulus"})
        assert session._activity.frames == []

    asyncio.run(run())
