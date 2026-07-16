"""Deliver researcher-owned survey images to the active Gemini Live session."""
from __future__ import annotations

import io
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx
from PIL import Image, UnidentifiedImageError
from livekit import rtc

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 1024
SURVEY_ASSETS_BUCKET = "survey-assets"


class StimulusDeliveryError(RuntimeError):
    """A configured image could not be safely delivered to Gemini Live."""


class _VideoInputActivity(Protocol):
    def push_video(self, frame: rtc.VideoFrame) -> None: ...


ImageLoader = Callable[[str], Awaitable[bytes]]


class GeminiLiveStimulusSender:
    """Fetch a survey-asset image, decode it, then push it into Gemini Live.

    LiveKit 1.5 exposes arbitrary video-frame forwarding on the active agent
    activity, while ``AgentSession`` exposes no equivalent public method. The
    lookup is kept in this one compatibility seam so an SDK upgrade has a
    single, loudly-failing replacement point rather than silently dropping a
    research stimulus.
    """

    def __init__(self, *, session: Any, appwrite_endpoint: str, loader: ImageLoader) -> None:
        self._session = session
        self._appwrite_endpoint = appwrite_endpoint
        self._loader = loader

    async def send(self, stimulus: dict[str, Any] | None) -> None:
        if not stimulus or stimulus.get("type") != "image":
            return
        url = stimulus.get("url")
        if not isinstance(url, str) or not url:
            raise StimulusDeliveryError("image stimulus is missing its survey-assets URL")
        _validate_survey_asset_url(url, self._appwrite_endpoint)
        frame = _decode_image_frame(await self._loader(url))
        activity = getattr(self._session, "_activity", None)
        push_video = getattr(activity, "push_video", None)
        if not callable(push_video):
            raise StimulusDeliveryError("active Gemini Live video input is unavailable")
        push_video(frame)


def build_stimulus_sender(
    *,
    session: Any,
    appwrite_endpoint: str | None,
    appwrite_project_id: str | None = None,
    loader: ImageLoader | None = None,
) -> GeminiLiveStimulusSender:
    if not appwrite_endpoint:
        raise StimulusDeliveryError("image stimuli require APPWRITE_ENDPOINT")
    if loader is None and not appwrite_project_id:
        raise StimulusDeliveryError("image stimuli require APPWRITE_PROJECT_ID")

    async def appwrite_loader(url: str) -> bytes:
        return await _download_image(url, appwrite_project_id=appwrite_project_id)

    return GeminiLiveStimulusSender(
        session=session,
        appwrite_endpoint=appwrite_endpoint,
        loader=loader or appwrite_loader,
    )


def _validate_survey_asset_url(url: str, appwrite_endpoint: str) -> None:
    candidate = urlsplit(url)
    endpoint = urlsplit(appwrite_endpoint)
    expected_prefix = f"{endpoint.path.rstrip('/')}/storage/buckets/{SURVEY_ASSETS_BUCKET}/files/"
    if (
        candidate.scheme not in {"http", "https"}
        or candidate.scheme != endpoint.scheme
        or candidate.netloc != endpoint.netloc
        or not candidate.path.startswith(expected_prefix)
        or not candidate.path.endswith("/view")
    ):
        raise StimulusDeliveryError("image stimulus URL must be a survey-assets Appwrite view URL")
    file_id = candidate.path[len(expected_prefix) : -len("/view")].strip("/")
    if not file_id or "/" in file_id:
        raise StimulusDeliveryError("image stimulus URL has an invalid survey-assets file ID")


async def _download_image(url: str, *, appwrite_project_id: str | None = None) -> bytes:
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            headers = {"X-Appwrite-Project": appwrite_project_id} if appwrite_project_id else {}
            async with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > MAX_IMAGE_BYTES:
                    raise StimulusDeliveryError("image stimulus exceeds the 5 MiB limit")
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > MAX_IMAGE_BYTES:
                        raise StimulusDeliveryError("image stimulus exceeds the 5 MiB limit")
                return bytes(chunks)
    except StimulusDeliveryError:
        raise
    except (httpx.HTTPError, ValueError) as error:
        raise StimulusDeliveryError("could not download image stimulus") from error


def _decode_image_frame(image_bytes: bytes) -> rtc.VideoFrame:
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise StimulusDeliveryError("image stimulus has unsupported dimensions")
            image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
            rgba = image.convert("RGBA")
            return rtc.VideoFrame(
                width=rgba.width,
                height=rgba.height,
                type=rtc.VideoBufferType.RGBA,
                data=bytearray(rgba.tobytes()),
            )
    except StimulusDeliveryError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise StimulusDeliveryError("image stimulus is not a supported image file") from error
