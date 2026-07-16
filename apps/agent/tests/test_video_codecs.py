def test_video_forwarding_codec_dependencies_are_installed() -> None:
    """A LiveKit video frame must be JPEG-encoded before Gemini can receive it."""

    from livekit import rtc
    from livekit.agents.utils import images

    frame = rtc.VideoFrame(
        width=2,
        height=2,
        type=rtc.VideoBufferType.RGBA,
        data=bytearray([127, 127, 127, 255] * 4),
    )

    assert images.encode(frame, images.EncodeOptions(format="JPEG")).startswith(b"\xff\xd8")
