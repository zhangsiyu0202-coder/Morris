"""Hello-world LiveKit Agent Worker.

Requires the `realtime` extra:  uv sync --extra realtime
Run:                            uv run python -m agent.main dev

On join it reads the room metadata (carrying sessionId, set by issueLivekitToken)
and logs it. The ai-interview-engine sub-spec will replace this with a
Supervisor / TaskGroup / AgentTask interview workflow.
"""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from agent.contracts import INTERVIEW_STATE_ATTRIBUTE, InterviewAgentState, InterviewRoomMetadata
from agent.interview.runtime_bridge import InterviewRuntimeBridge
from agent.logging import create_logger

log = create_logger("agent.main")


async def entrypoint(ctx) -> None:  # ctx: livekit.agents.JobContext
    await ctx.connect()
    raw_metadata = ctx.room.metadata or "{}"
    metadata = {}
    try:
        metadata = json.loads(raw_metadata)
    except (ValueError, AttributeError):
        pass
    session_id = metadata.get("sessionId", "unknown")
    log.info("agent joined room", sessionId=session_id, room=getattr(ctx.room, "name", None))

    room_metadata: InterviewRoomMetadata | None = None
    try:
        room_metadata = InterviewRoomMetadata.model_validate_json(raw_metadata)
    except Exception:
        room_metadata = None

    if room_metadata and (room_metadata.runtimeStudy or room_metadata.workflowConfig):
        bridge = InterviewRuntimeBridge(ctx.room, room_metadata, log)
        await bridge.start()
    else:
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
