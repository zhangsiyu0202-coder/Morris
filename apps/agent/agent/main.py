"""Production Python LiveKit worker: Gemini Live audio plus official video input."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from livekit.agents import Agent, JobContext, WorkerOptions, cli

from .finalize import finalize_interview_session
from .flow import FlowRunner
from .health import start_health_server
from .livekit_host import LiveKitFlowHost
from .metadata import parse_room_metadata
from .runtime import build_gemini_session
from .settings import prepare_google_plugin_environment, resolve_gemini_settings
from .stimulus import build_stimulus_sender

AGENT_NAME = "merism-gemini-live-video-worker"
DEFAULT_FLOW_MODEL = "gemini-2.5-flash"
log = logging.getLogger("agent.main")


def _metadata_for(ctx: JobContext):
    job_raw = getattr(ctx.job, "metadata", None)
    parsed = parse_room_metadata(job_raw)
    if parsed.ok or parsed.reason != "empty":
        return parsed
    return parse_room_metadata(getattr(ctx.room, "metadata", None))


def _instructions(moderator_instruction: str, *, session_id: str, survey_id: str) -> str:
    return "\n\n".join(
        (
            moderator_instruction,
            f"Session ID: {session_id}",
            f"Survey ID: {survey_id}",
            "You are conducting a qualitative interview. The application controls question order.",
            "Only ask a question supplied by the application. Never reveal internal IDs or workflow steps.",
        )
    )


async def entrypoint(ctx: JobContext) -> None:
    parsed = _metadata_for(ctx)
    if not parsed.ok or parsed.metadata is None or parsed.metadata.flow_config is None:
        raise RuntimeError(f"agent-worker: refusing job metadata ({parsed.reason})")
    metadata = parsed.metadata
    settings = resolve_gemini_settings(os.environ)
    prepare_google_plugin_environment(os.environ, settings)
    instructions = _instructions(
        metadata.flow_config.moderator_instruction,
        session_id=metadata.session_id,
        survey_id=metadata.survey_id,
    )

    await ctx.connect()
    session, room_options = build_gemini_session(settings, instructions=instructions)
    host = LiveKitFlowHost(
        room=ctx.room,
        session=session,
        api_key=settings.api_key,
        flow_model=os.getenv("GEMINI_FLOW_MODEL", DEFAULT_FLOW_MODEL),
        runtime_study=metadata.runtime_study,
        stimulus_sender=build_stimulus_sender(
            session=session,
            appwrite_endpoint=os.getenv("APPWRITE_ENDPOINT"),
            appwrite_project_id=os.getenv("APPWRITE_PROJECT_ID"),
        ),
    )
    await session.start(agent=Agent(instructions=instructions), room=ctx.room, room_options=room_options)

    runner = FlowRunner(metadata.flow_config, host)
    flow_task = asyncio.create_task(runner.run(), name=f"merism-flow-{metadata.session_id}")
    completed = False
    failed = False

    def _record_completion(task: asyncio.Task[Any]) -> None:
        nonlocal completed, failed
        if task.cancelled():
            return
        if task.exception() is None:
            completed = True
        else:
            failed = True

    flow_task.add_done_callback(_record_completion)

    async def shutdown() -> None:
        terminal_status = "completed" if completed else "failed" if failed else "abandoned"
        if not flow_task.done():
            flow_task.cancel()
        try:
            await finalize_interview_session(
                session_id=metadata.session_id,
                survey_id=metadata.survey_id,
                terminal_status=terminal_status,
                collected_answers={
                    step_id: {
                        "questionContent": answer.question_content,
                        "respondentAnswer": answer.respondent_answer,
                        "selectedOptionIds": answer.selected_option_ids,
                    }
                    for step_id, answer in runner.state.answers.items()
                },
                transcript=host.transcript,
            )
        except Exception as error:
            # Finalization is best-effort only after the realtime session ends;
            # never expose configuration or provider secrets in this message.
            log.error(
                "agent.finalize_failed session=%s error=%s",
                metadata.session_id,
                type(error).__name__,
            )
        await session.aclose()

    ctx.add_shutdown_callback(shutdown)


if __name__ == "__main__":
    start_health_server()
    # The repository owns :8082 for the stable readiness probe. LiveKit's
    # internal worker HTTP endpoint is not product-facing, so use an ephemeral
    # port and avoid colliding with Appwrite/local tooling on :8081.
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=AGENT_NAME, port=0))
