"""MerismV2 LiveKit Agent Worker entrypoint.

Requires the `realtime` extra:  uv sync --extra realtime
Run:                            uv run python -m agent.main dev

On join it reads the room metadata (carrying sessionId + the interview config,
set by issueLivekitToken). Routing:

- metadata has runtimeStudy/workflowConfig AND provider creds present
      -> full voice interview (Supervisor / TaskGroup / AgentTask + Qwen/DeepSeek)
- metadata has runtimeStudy/workflowConfig but no provider creds
      -> UI-only RPC bridge (frontend submits answers, agent advances state)
- otherwise
      -> idle
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime

from agent.contracts import INTERVIEW_STATE_ATTRIBUTE, InterviewAgentState, InterviewRoomMetadata
from agent.interview.runtime_bridge import InterviewRuntimeBridge
from agent.logging import create_logger
from agent.providers.settings import provider_settings_available, resolve_provider_settings

log = create_logger("agent.main")


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
        )
        await engine.start()
        await asyncio.Event().wait()
        return

    if has_config:
        log.warn("provider creds missing; falling back to UI-only RPC bridge", sessionId=session_id)
        bridge = InterviewRuntimeBridge(ctx.room, room_metadata, log)
        await bridge.start()
        await asyncio.Event().wait()
        return

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
    # Imported lazily so the package is importable without the realtime extra.
    from livekit.agents import WorkerOptions, cli

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
