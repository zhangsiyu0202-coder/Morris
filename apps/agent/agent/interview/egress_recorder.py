"""LiveKit room-composite egress for interview video recordings.

Starts a room-composite MP4 egress when the interview begins, stops it on
completion, polls for the finalized artifact, and returns the bytes for upload
to Appwrite. Missing egress infrastructure or API failures degrade gracefully
(the caller logs and continues without blocking session completion).
"""
from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

RecordingFormat = Literal["mp4", "webm", "mp3", "opus", "wav"]


@dataclass(frozen=True)
class EgressSettings:
    livekit_url: str
    api_key: str
    api_secret: str
    s3_bucket: str | None = None
    s3_access_key: str | None = None
    s3_secret: str | None = None
    s3_endpoint: str | None = None
    s3_region: str | None = None
    output_dir: str | None = None
    local_mount: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "EgressSettings | None":
        url = env.get("LIVEKIT_URL")
        key = env.get("LIVEKIT_API_KEY")
        secret = env.get("LIVEKIT_API_SECRET")
        if not (url and key and secret):
            return None
        return cls(
            livekit_url=url,
            api_key=key,
            api_secret=secret,
            s3_bucket=env.get("LIVEKIT_EGRESS_S3_BUCKET") or env.get("EGRESS_S3_BUCKET"),
            s3_access_key=env.get("LIVEKIT_EGRESS_S3_ACCESS_KEY") or env.get("EGRESS_S3_ACCESS_KEY"),
            s3_secret=env.get("LIVEKIT_EGRESS_S3_SECRET") or env.get("EGRESS_S3_SECRET"),
            s3_endpoint=env.get("LIVEKIT_EGRESS_S3_ENDPOINT") or env.get("EGRESS_S3_ENDPOINT"),
            s3_region=env.get("LIVEKIT_EGRESS_S3_REGION") or env.get("EGRESS_S3_REGION"),
            output_dir=env.get("EGRESS_OUTPUT_DIR", "/out"),
            local_mount=env.get("EGRESS_LOCAL_MOUNT"),
        )


@dataclass(frozen=True)
class RecordingArtifact:
    data: bytes
    format: RecordingFormat
    duration_ms: int


def _http_livekit_url(ws_url: str) -> str:
    return ws_url.replace("wss://", "https://").replace("ws://", "http://")


def _format_from_filename(name: str) -> RecordingFormat:
    lowered = name.lower()
    for ext in ("mp4", "webm", "mp3", "opus", "wav"):
        if lowered.endswith(f".{ext}"):
            return ext  # type: ignore[return-value]
    return "mp4"


class EgressRecorder:
    """Manages one room-composite egress for a single interview session."""

    def __init__(self, settings: EgressSettings, logger: Any) -> None:
        self._settings = settings
        self._log = logger
        self._egress_id: str | None = None

    @property
    def egress_id(self) -> str | None:
        return self._egress_id

    async def start(self, *, room_name: str, session_id: str) -> bool:
        """Begin room-composite video egress. Returns False on failure."""
        from livekit import api
        from livekit.protocol.egress import EncodedFileOutput, EncodedFileType, RoomCompositeEgressRequest

        output_dir = (self._settings.output_dir or "recordings").rstrip("/")
        filepath = f"{output_dir}/{session_id}.mp4"
        file_output = EncodedFileOutput(
            file_type=EncodedFileType.MP4,
            filepath=filepath,
        )
        if self._settings.s3_bucket:
            from livekit.protocol.egress import S3Upload

            file_output = EncodedFileOutput(
                file_type=EncodedFileType.MP4,
                filepath=filepath,
                s3=S3Upload(
                    bucket=self._settings.s3_bucket,
                    access_key=self._settings.s3_access_key or "",
                    secret=self._settings.s3_secret or "",
                    endpoint=self._settings.s3_endpoint or "",
                    region=self._settings.s3_region or "",
                ),
            )

        request = RoomCompositeEgressRequest(
            room_name=room_name,
            layout="grid",
            file_outputs=[file_output],
        )
        http_url = _http_livekit_url(self._settings.livekit_url)
        try:
            async with api.LiveKitAPI(
                url=http_url,
                api_key=self._settings.api_key,
                api_secret=self._settings.api_secret,
            ) as lk:
                info = await lk.egress.start_room_composite_egress(request)
                self._egress_id = info.egress_id
                self._log.info(
                    "room composite egress started",
                    sessionId=session_id,
                    egressId=self._egress_id,
                    room=room_name,
                )
                return True
        except Exception as error:  # noqa: BLE001 - egress is optional
            self._log.warn(
                "failed to start room composite egress",
                sessionId=session_id,
                room=room_name,
                error=str(error),
            )
            self._egress_id = None
            return False

    async def finalize(self, *, session_id: str, timeout_s: float = 300.0) -> RecordingArtifact | None:
        """Stop egress, wait for completion, and return the recording bytes."""
        if not self._egress_id:
            return None

        from livekit import api
        from livekit.protocol.egress import ListEgressRequest, StopEgressRequest

        http_url = _http_livekit_url(self._settings.livekit_url)
        try:
            async with api.LiveKitAPI(
                url=http_url,
                api_key=self._settings.api_key,
                api_secret=self._settings.api_secret,
            ) as lk:
                await lk.egress.stop_egress(StopEgressRequest(egress_id=self._egress_id))
                info = await self._wait_for_complete(lk, self._egress_id, timeout_s=timeout_s)
                if info is None:
                    self._log.warn("egress did not complete in time", sessionId=session_id)
                    return None
                if info.status == api.EGRESS_FAILED:
                    self._log.warn(
                        "egress failed",
                        sessionId=session_id,
                        egressId=self._egress_id,
                        error=info.error,
                    )
                    return None
                artifact = await self._load_artifact(info)
                if artifact is None:
                    self._log.warn("egress completed without a downloadable file", sessionId=session_id)
                return artifact
        except Exception as error:  # noqa: BLE001 - recording must not block completion
            self._log.warn(
                "failed to finalize room composite egress",
                sessionId=session_id,
                egressId=self._egress_id,
                error=str(error),
            )
            return None

    async def _wait_for_complete(self, lk: Any, egress_id: str, *, timeout_s: float) -> Any | None:
        from livekit import api
        from livekit.protocol.egress import ListEgressRequest

        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            response = await lk.egress.list_egress(ListEgressRequest(egress_id=egress_id))
            if response.items:
                info = response.items[0]
                if info.status in (
                    api.EGRESS_COMPLETE,
                    api.EGRESS_FAILED,
                    api.EGRESS_ABORTED,
                ):
                    return info
            await asyncio.sleep(2)
        return None

    async def _load_artifact(self, info: Any) -> RecordingArtifact | None:
        if not info.file_results:
            return None
        file_info = info.file_results[0]
        filename = file_info.filename or "interview.mp4"
        duration_ms = int(file_info.duration * 1000) if file_info.duration else 0
        recording_format = _format_from_filename(filename)
        location = file_info.location or ""

        if location.startswith("http://") or location.startswith("https://"):
            import httpx

            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.get(location)
                response.raise_for_status()
                return RecordingArtifact(
                    data=response.content,
                    format=recording_format,
                    duration_ms=duration_ms,
                )

        local_path = self._resolve_local_path(location, filename)
        if local_path is None or not os.path.isfile(local_path):
            self._log.warn(
                "egress artifact unreachable: location is neither an HTTP URL "
                "nor a resolvable local path. If LiveKit egress is configured "
                "with S3, set EGRESS_LOCAL_MOUNT or rely on presigned URLs.",
                location=location,
                filename=filename,
            )
            return None
        with open(local_path, "rb") as handle:
            return RecordingArtifact(
                data=handle.read(),
                format=recording_format,
                duration_ms=duration_ms,
            )

    def _resolve_local_path(self, location: str, filename: str) -> str | None:
        if self._settings.local_mount:
            if location.startswith("/"):
                relative = location.lstrip("/")
                return os.path.join(self._settings.local_mount, relative)
            return os.path.join(self._settings.local_mount, os.path.basename(location or filename))
        if location and os.path.isabs(location):
            return location
        return None
