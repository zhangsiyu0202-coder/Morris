"""Voice interview engine: wires providers, session, supervisor, persistence.

This is the realtime entry point used by ``agent.main`` when provider
credentials are present. It:

1. resolves the workflow config from room metadata (pure),
2. builds an ``AgentSession`` — Qwen STT + DeepSeek LLM + Qwen TTS by default,
   or (ADR-0007, ``MERISM_GEMINI_LIVE=1``) Gemini Live in AUDIO modality
   (Gemini does ASR + LLM + TTS in one model, no external TTS),
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
from agent.interview.workflow import (
    index_runtime_questions,
    initial_workflow_state,
    workflow_config_from_metadata,
)
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
        vad: Any | None = None,
    ) -> None:
        self._room = room
        self._metadata = metadata
        self._settings = settings
        self._repo = repository
        self._log = logger
        # Prewarmed silero VAD from the worker process (ctx.proc.userdata), or
        # None — _build_session falls back to loading one for the cascade mode.
        self._vad = vad
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
        runtime_questions = (
            index_runtime_questions(self._metadata.runtimeStudy)
            if self._metadata.runtimeStudy is not None
            else {}
        )
        supervisor = supervisor_class(
            room=self._room,
            state=state,
            transcript=self._transcript,
            repository=self._repo,
            logger=self._log,
            egress_recorder=egress_recorder,
            runtime_questions=runtime_questions,
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
                "participant egress skipped: LiveKit credentials missing",
                sessionId=self._metadata.sessionId,
            )
            return None

        room_name = getattr(self._room, "name", None)
        if not room_name:
            self._log.warn(
                "participant egress skipped: room name unavailable",
                sessionId=self._metadata.sessionId,
            )
            return None

        recorder = EgressRecorder(settings, self._log)
        started = await recorder.start(room_name=room_name, session_id=self._metadata.sessionId)
        return recorder if started else None

    def _build_session(self) -> Any:
        from livekit.agents import AgentSession

        # ADR-0007: Gemini Live in AUDIO modality. Gemini does ASR + LLM + TTS
        # in one model — no external TTS is wired in. Both speakers' transcripts
        # are still captured via Live's input/output audio transcription configs
        # (set in providers.gemini._realtime_kwargs), so the transcript collector
        # and downstream analysis pipeline are unchanged. Gemini Live runs its
        # own server-side turn detection, so this mode runs WITHOUT a local
        # silero VAD (no per-session VAD load, no double detection).
        if self._settings.gemini is not None:
            from agent.providers.gemini import build_realtime_llm

            return AgentSession(
                llm=build_realtime_llm(self._settings.gemini),
            )

        # Default: Qwen STT + DeepSeek LLM + Qwen TTS cascade. The cascade has no
        # server-side turn detection, so it needs a local silero VAD. Reuse the
        # prewarmed instance (loaded once per worker process) when available;
        # otherwise load one here (dev mode / no prewarm).
        tts = build_tts(self._settings.speech)
        vad = self._vad
        if vad is None:
            from livekit.plugins import silero

            vad = silero.VAD.load()

        return AgentSession(
            stt=build_stt(self._settings.speech),
            tts=tts,
            llm=build_llm(self._settings.llm),
            vad=vad,
        )

    def _build_room_options(self) -> Any:
        """Enable LiveKit room transcription output for both speakers.

        ``RoomIO`` publishes the agent's TTS transcription and the interviewee's
        STT transcription to the room as LiveKit transcription segments, which
        the web client reads via ``RoomEvent.TranscriptionReceived`` (or the
        ``lk.transcription`` text stream). ``RoomOptions`` is the current API in
        livekit-agents 1.5.x–1.6; ``RoomOutputOptions`` is deprecated. This only
        controls in-room realtime output and is independent of the local
        ``TranscriptCollector`` used for Appwrite persistence.
        """
        from livekit.agents.voice.room_io import RoomOptions, TextOutputOptions

        return RoomOptions(
            text_output=TextOutputOptions(sync_transcription=True),
        )

    def _wire_transcription(self, session: Any) -> None:
        """Forward finalized conversation turns into the transcript buffer +
        normalize interviewee text to Simplified Chinese in place.

        livekit emits ``conversation_item_added`` with a role + text content.
        Exact timing isn't always available on the event, so a monotonic cursor
        is used to keep segments ordered for the analysis module's citations.

        Why mutate events in place: Gemini Live ASR returns Traditional Chinese
        for Mandarin audio in AI Studio mode (Vertex-AI-only `language_codes`
        kwarg is rejected, see ``gemini.py``). LiveKit's RoomIO subscribes to
        ``user_input_transcribed`` and ``conversation_item_added`` to publish
        the transcription to the room as a LiveKit transcription stream. We
        register our normalizer FIRST so the mutated `ev.transcript` /
        ``message.content`` flows through to RoomIO, the persistence layer,
        and the browser uniformly. pyee's ``EventEmitter`` calls listeners in
        registration order; we register here, before ``session.start()`` wires
        RoomIO listeners.
        """
        from agent.interview.transcript import normalize_interviewee_text

        def normalize_user_event(ev: Any) -> None:
            transcript = getattr(ev, "transcript", "") or ""
            if not transcript:
                return
            normalized = normalize_interviewee_text(transcript)
            if normalized != transcript:
                # Pydantic v2 BaseModel allows attribute assignment unless
                # frozen; UserInputTranscribedEvent is not frozen.
                try:
                    ev.transcript = normalized
                except Exception as error:  # noqa: BLE001 - best-effort
                    self._log.warn(
                        "could not normalize user_input_transcribed",
                        error=str(error),
                    )

        def normalize_user_item(event: Any) -> None:
            item = getattr(event, "item", event)
            role = getattr(item, "role", "") or ""
            if role != "user":
                return
            content = getattr(item, "content", None)
            if not content:
                return
            new_content: list[Any] = []
            mutated = False
            for part in content:
                if isinstance(part, str):
                    norm = normalize_interviewee_text(part)
                    new_content.append(norm)
                    if norm != part:
                        mutated = True
                else:
                    new_content.append(part)
            if mutated:
                try:
                    item.content = new_content
                except Exception as error:  # noqa: BLE001 - best-effort
                    self._log.warn(
                        "could not normalize conversation_item content",
                        error=str(error),
                    )

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
            # ORDER MATTERS: normalizers BEFORE on_item / RoomIO listeners.
            session.on("user_input_transcribed", normalize_user_event)
            session.on("conversation_item_added", normalize_user_item)
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
