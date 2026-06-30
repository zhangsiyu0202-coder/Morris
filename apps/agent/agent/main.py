"""MerismV2 LiveKit Agent Worker entrypoint.

Requires the `realtime` extra:  uv sync --extra realtime
Run:                            uv run python -m agent.main dev

On join it reads the room metadata (carrying sessionId + the interview config,
set by issueLivekitToken). Routing:

- metadata has runtimeStudy/workflowConfig AND provider creds present
      -> full voice interview (Supervisor / TaskGroup / AgentTask + Qwen-VL cascade)
- metadata has runtimeStudy/workflowConfig but no provider creds
      -> error (the interview cannot run without the LLM provider) + idle
- otherwise
      -> idle
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
from datetime import UTC, datetime

from agent.contracts import INTERVIEW_STATE_ATTRIBUTE, InterviewAgentState, InterviewRoomMetadata
from agent.health import start_health_server, write_prestop_marker
from agent.logging import create_logger
from agent.providers.settings import (
    gemini_live_enabled,
    provider_settings_available,
    resolve_provider_settings,
)

log = create_logger("agent.main")


def _install_drain_handler() -> None:
    """Install a SIGTERM handler that writes the prestop marker so the next
    /_readyz returns 503 and k8s stops routing traffic. In-flight rooms keep
    running to completion (LiveKit AgentSession + TaskGroup tear-down handles
    finalization).

    Idempotent: re-registering on SIGTERM during drain is a no-op. SIGINT
    (Ctrl-C in dev) gets the same handler so local `uv run python -m agent.main`
    behaves like k8s for testing.
    """

    def _handler(signum, _frame) -> None:  # noqa: ANN001 - signal API
        log.info("agent.signal.received", signal=signum)
        write_prestop_marker()
        # Do NOT call sys.exit here. livekit-agents' own shutdown path needs
        # to finish in-flight jobs first. The marker is enough — k8s will
        # follow up with SIGKILL after its terminationGracePeriodSeconds.

    try:
        signal.signal(signal.SIGTERM, _handler)
        signal.signal(signal.SIGINT, _handler)
    except ValueError:
        # signal.signal raises if called from a non-main thread (e.g. inside
        # tests that import main). Safe to skip; production main thread sets it.
        log.warn("agent.signal.install_skipped_non_main_thread")


def prewarm(proc) -> None:  # proc: livekit.agents.JobProcess
    """Load slow model files once per worker process, before any job.

    Only the default cascade mode uses a local silero VAD; the Gemini Live mode
    relies on server-side turn detection, so when that mode is enabled there is
    nothing to prewarm (avoids loading the VAD weights for nothing).
    """
    if gemini_live_enabled(os.environ):
        return
    from livekit.plugins import silero

    proc.userdata["vad"] = silero.VAD.load()


def _parse_room_metadata(raw_metadata: str) -> tuple[str, InterviewRoomMetadata | None]:
    session_id = "unknown"
    try:
        session_id = json.loads(raw_metadata).get("sessionId", "unknown")
    except (ValueError, AttributeError):
        pass
    try:
        return session_id, InterviewRoomMetadata.model_validate_json(raw_metadata)
    except Exception:
        return session_id, None


def _build_repository(env):
    """Build an Appwrite repository if server credentials are configured."""
    if not (env.get("APPWRITE_ENDPOINT") and env.get("APPWRITE_PROJECT_ID") and env.get("APPWRITE_API_KEY")):
        log.warn("Appwrite credentials missing; interview results will not be persisted")
        return None
    try:
        from agent.persistence import InterviewRepository

        return InterviewRepository.from_env(env, log)
    except Exception as error:  # noqa: BLE001 - persistence is optional, never block the call
        log.error("failed to init Appwrite repository", error=str(error))
        return None


async def entrypoint(ctx) -> None:  # ctx: livekit.agents.JobContext
    await ctx.connect()
    raw_metadata = ctx.room.metadata or "{}"
    session_id, room_metadata = _parse_room_metadata(raw_metadata)
    log.info("agent joined room", sessionId=session_id, room=getattr(ctx.room, "name", None))

    has_config = bool(room_metadata and (room_metadata.runtimeStudy or room_metadata.workflowConfig))

    if has_config and provider_settings_available(os.environ):
        from agent.interview.engine import InterviewEngine

        engine = InterviewEngine(
            room=ctx.room,
            metadata=room_metadata,
            settings=resolve_provider_settings(os.environ),
            repository=_build_repository(os.environ),
            logger=log,
            vad=ctx.proc.userdata.get("vad"),
        )
        await engine.start()
        await asyncio.Event().wait()
        return

    if has_config:
        log.error(
            "provider settings missing; interview cannot run without the LLM provider",
            sessionId=session_id,
        )

    ctx.room.local_participant.set_attributes(
        {
            INTERVIEW_STATE_ATTRIBUTE: InterviewAgentState(
                status="idle",
                updatedAt=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            ).model_dump_json()
        }
    )
    await asyncio.Event().wait()


def main() -> None:
    # Health server (REQ-3): start before the worker loop so k8s probes
    # answer immediately. Daemon thread = dies with the process.
    start_health_server()
    # SIGTERM drain handler (REQ-3): writes the prestop marker, then lets
    # the worker finish in-flight jobs before k8s SIGKILL.
    _install_drain_handler()
    # Imported lazily so the package is importable without the realtime extra.
    from livekit.agents import WorkerOptions, cli

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))


if __name__ == "__main__":
    main()
