"""Voice interview engine: wires providers, session, supervisor, persistence.

This is the realtime entry point used by ``agent.main`` when provider
credentials are present. It:

1. resolves the workflow config from room metadata (pure),
2. builds an ``AgentSession`` with Qwen STT/TTS + DeepSeek LLM,
3. forwards finalized conversation turns into the ``TranscriptCollector``,
4. publishes both speakers' transcription to the LiveKit room (so the web
   client can listen via ``RoomEvent.TranscriptionReceived`` / the
   ``lk.transcription`` text stream),
5. starts the ``InterviewSupervisorAgent`` which runs the section/question loop
   and persists to Appwrite.

livekit imports are lazy; the resolution / state logic lives in pure modules
(``workflow``, ``transcript``, ``persistence``) that are unit tested.
"""
from __future__ import annotations

import os
from typing import Any

from agent.contracts import InterviewRoomMetadata
from agent.interview.egress_recorder import EgressRecorder, EgressSettings
from agent.interview.supervisor import create_supervisor_agent_class
from agent.interview.transcript import (
    SPEAKER_AGENT,
    SPEAKER_INTERVIEWEE,
    TranscriptCollector,
)
from agent.interview.workflow import initial_workflow_state, workflow_config_from_metadata
from agent.providers.deepseek import build_llm
from agent.providers.qwen import build_stt, build_tts
from agent.providers.settings import ProviderSettings


class InterviewEngine:
    """Orchestrates a single voice interview session."""

    def __init__(
        self,
        *,
        room: Any,
        metadata: InterviewRoomMetadata,
        settings: ProviderSettings,
        repository: Any | None,
        logger: Any,
    ) -> None:
        self._room = room
        self._metadata = metadata
        self._settings = settings
        self._repo = repository
        self._log = logger
        self._transcript = TranscriptCollector()
        self._turn_cursor_ms = 0

    async def start(self) -> None:
        config = workflow_config_from_metadata(self._metadata)
        if config is None or not config.sections:
            self._log.warn("no workflow config; nothing to run", sessionId=self._metadata.sessionId)
            return

        state = initial_workflow_state(config)
        session = self._build_session()
        self._wire_transcription(session)

        egress_recorder = await self._start_egress_recording()

        supervisor_class = create_supervisor_agent_class()
        supervisor = supervisor_class(
            room=self._room,
            state=state,
            transcript=self._transcript,
            repository=self._repo,
            logger=self._log,
            egress_recorder=egress_recorder,
        )

        self._log.info(
            "starting voice interview",
            sessionId=self._metadata.sessionId,
            sections=len(config.sections),
        )
        await session.start(
            agent=supervisor,
            room=self._room,
            room_options=self._build_room_options(),
        )

    # -- internals --------------------------------------------------------

    async def _start_egress_recording(self) -> EgressRecorder | None:
        settings = EgressSettings.from_env(os.environ)
        if settings is None:
            self._log.warn(
                "room composite egress skipped: LiveKit credentials missing",
                sessionId=self._metadata.sessionId,
            )
            return None

        room_name = getattr(self._room, "name", None)
        if not room_name:
            self._log.warn(
                "room composite egress skipped: room name unavailable",
                sessionId=self._metadata.sessionId,
            )
            return None

        recorder = EgressRecorder(settings, self._log)
        started = await recorder.start(room_name=room_name, session_id=self._metadata.sessionId)
        return recorder if started else None

    def _build_session(self) -> Any:
        from livekit.agents import AgentSession
        from livekit.plugins import silero

        return AgentSession(
            stt=build_stt(self._settings.speech),
            tts=build_tts(self._settings.speech),
            llm=build_llm(self._settings.llm),
            vad=silero.VAD.load(),
        )

    def _build_room_options(self) -> Any:
        """Enable LiveKit room transcription output for both speakers.

        ``RoomIO`` publishes the agent's TTS transcription and the interviewee's
        STT transcription to the room as LiveKit transcription segments, which
        the web client reads via ``RoomEvent.TranscriptionReceived`` (or the
        ``lk.transcription`` text stream). ``RoomOptions`` is the current API in
        livekit-agents 1.5.x; ``RoomOutputOptions`` is deprecated. This only
        controls in-room realtime output and is independent of the local
        ``TranscriptCollector`` used for Appwrite persistence.
        """
        from livekit.agents.voice.room_io import RoomOptions, TextOutputOptions

        return RoomOptions(
            text_output=TextOutputOptions(sync_transcription=True),
        )

    def _wire_transcription(self, session: Any) -> None:
        """Forward finalized conversation turns into the transcript buffer.

        livekit emits ``conversation_item_added`` with a role + text content.
        Exact timing isn't always available on the event, so a monotonic cursor
        is used to keep segments ordered for the analysis module's citations.
        """

        def on_item(event: Any) -> None:
            item = getattr(event, "item", event)
            role = getattr(item, "role", "") or ""
            text = self._extract_text(item)
            if not text:
                return
            speaker = SPEAKER_AGENT if role == "assistant" else SPEAKER_INTERVIEWEE
            start_ms = self._turn_cursor_ms
            end_ms = start_ms + max(1, len(text) * 60)  # ~heuristic duration
            self._turn_cursor_ms = end_ms
            self._transcript.add(speaker=speaker, start_ms=start_ms, end_ms=end_ms, text=text)

        try:
            session.on("conversation_item_added", on_item)
        except Exception as error:  # noqa: BLE001 - event wiring is best-effort
            self._log.warn("could not register transcription listener", error=str(error))

    @staticmethod
    def _extract_text(item: Any) -> str:
        content = getattr(item, "text_content", None) or getattr(item, "content", None)
        if content is None:
            return ""
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, (list, tuple)):
            parts = [part for part in content if isinstance(part, str)]
            return " ".join(parts).strip()
        return str(content).strip()
