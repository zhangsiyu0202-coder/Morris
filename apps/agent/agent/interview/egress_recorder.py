"""LiveKit participant egress for interview video recordings.

Records the interviewee participant's tracks (camera + mic + screen
share) for the duration of the session, polls for the finalized mp4
when the session ends, and returns the bytes for upload to Appwrite.

Per LiveKit's egress overview, ``ParticipantEgressRequest`` is the
canonical mode for "record one participant in a realtime session" —
it runs server-side without a Chromium compositor (unlike
``RoomCompositeEgressRequest``), starts in <1s, and auto-stops when
the participant leaves the room.

Missing egress infrastructure or API failures degrade gracefully
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
    """Records the interviewee participant's tracks for a single session.

    Uses LiveKit's ``ParticipantEgressRequest`` rather than the heavier
    ``RoomCompositeEgressRequest``: per the official egress overview, the
    participant variant is "designed to simplify the workflow of
    recording participants in a realtime session, and handles the
    changes in track state, such as when a track is muted." It records
    server-side without spinning up a second Chromium instance, starts
    in <1s instead of 5-10s, and stops automatically when the
    interviewee leaves the room.

    Identity convention: ``interviewee:<sessionId>`` (set by the
    ``issueLivekitToken`` Function on the LiveKit access token).
    """

    def __init__(self, settings: EgressSettings, logger: Any) -> None:
        self._settings = settings
        self._log = logger
        self._egress_id: str | None = None

    @property
    def egress_id(self) -> str | None:
        return self._egress_id

    async def start(self, *, room_name: str, session_id: str) -> bool:
        """Begin participant egress for ``interviewee:<sessionId>``.

        ``screen_share=True`` so the recording captures camera + mic +
        any screen share the interviewee opts into. Returns False on
        failure; egress is optional and must never block the session.
        """
        from livekit import api
        from livekit.protocol.egress import (
            EncodedFileOutput,
            EncodedFileType,
            ParticipantEgressRequest,
        )

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

        request = ParticipantEgressRequest(
            room_name=room_name,
            identity=f"interviewee:{session_id}",
            screen_share=True,
            file_outputs=[file_output],
        )
        http_url = _http_livekit_url(self._settings.livekit_url)
        try:
            async with api.LiveKitAPI(
                url=http_url,
                api_key=self._settings.api_key,
                api_secret=self._settings.api_secret,
            ) as lk:
                info = await lk.egress.start_participant_egress(request)
                self._egress_id = info.egress_id
                self._log.info(
                    "participant egress started",
                    sessionId=session_id,
                    egressId=self._egress_id,
                    room=room_name,
                    identity=f"interviewee:{session_id}",
                )
                return True
        except Exception as error:  # noqa: BLE001 - egress is optional
            self._log.warn(
                "failed to start participant egress",
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
                # Tolerate the "already complete" race: when the source
                # closes (browser disconnects mid-interview), egress
                # auto-completes before the supervisor can call StopEgress.
                # The Twirp call then raises ``failed_precondition`` 412.
                # We treat that as a successful no-op and proceed to
                # collect the artifact, since the file is already on disk.
                try:
                    await lk.egress.stop_egress(StopEgressRequest(egress_id=self._egress_id))
                except Exception as stop_error:  # noqa: BLE001 - error inspected below
                    msg = str(stop_error).lower()
                    already_done = (
                        "egress_complete cannot be stopped" in msg
                        or "egress_aborted cannot be stopped" in msg
                        or "egress_failed cannot be stopped" in msg
                    )
                    if not already_done:
                        raise
                    self._log.info(
                        "egress already finished before stop request; collecting artifact",
                        sessionId=session_id,
                        egressId=self._egress_id,
                    )
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
                "failed to finalize participant egress",
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
        # LiveKit egress reports ``duration`` as a nanosecond integer
        # (per livekit-protocol/proto/livekit_egress.proto), not as
        # seconds. Convert ns -> ms; older builds returning ``0`` (no
        # duration available) flow through the existing fallback.
        raw_duration = getattr(file_info, "duration", 0) or 0
        duration_ms = int(raw_duration / 1_000_000)
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
            # The container writes to ``output_dir`` (e.g. ``/out``) which is
            # bind-mounted from ``local_mount`` on the host. The container
            # absolute path is therefore <output_dir>/<filename>; on the host
            # the file lives directly under <local_mount>, NOT under
            # <local_mount>/<output_dir>. Strip the output_dir prefix so the
            # join produces a real host path.
            output_dir = (self._settings.output_dir or "").rstrip("/")
            normalized = location
            if output_dir and normalized.startswith(output_dir + "/"):
                normalized = normalized[len(output_dir) + 1:]
            elif normalized.startswith("/"):
                normalized = normalized.lstrip("/")
            # When normalized still has a path separator (e.g. nested
            # subdirs under output_dir), preserve it; otherwise just join
            # the basename for safety.
            if "/" in normalized:
                return os.path.join(self._settings.local_mount, normalized)
            return os.path.join(self._settings.local_mount, os.path.basename(normalized or filename))
        if location and os.path.isabs(location):
            return location
        return None
