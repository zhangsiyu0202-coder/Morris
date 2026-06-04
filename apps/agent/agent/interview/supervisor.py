"""InterviewSupervisorAgent: the long-lived agent that drives the interview.

Per ADR 0001 the supervisor owns the whole session: it greets, then walks each
survey section as a LiveKit ``TaskGroup`` (one ``AgentTask`` per question),
records each ``QuestionTaskResult`` into the pure workflow state, publishes the
live ``InterviewAgentState`` for the frontend, and streams progress to Appwrite.

The livekit ``Agent`` base class is imported lazily so this module is importable
without the ``realtime`` extra. All correctness-bearing transitions are
delegated to ``agent.interview.workflow`` (pure, tested).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from agent.contracts import (
    INTERVIEW_STATE_ATTRIBUTE,
    InterviewAgentState,
    InterviewWorkflowState,
    QuestionTaskResult,
    SectionTaskGroupConfig,
)
from agent.interview.task_group_builder import build_section_task_group
from agent.interview.workflow import (
    advance_to,
    collected_answers_map,
    is_complete,
    record_question_result,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def create_supervisor_agent_class():
    """Build the ``InterviewSupervisorAgent`` class (lazy livekit import)."""
    from livekit.agents import Agent

    class InterviewSupervisorAgent(Agent):
        def __init__(
            self,
            *,
            room: Any,
            state: InterviewWorkflowState,
            transcript: Any,
            repository: Any | None,
            logger: Any,
        ) -> None:
            self._room = room
            self._state = state
            self._transcript = transcript
            self._repo = repository
            self._log = logger
            super().__init__(instructions=state.workflowConfig.supervisorInstruction)

        # -- lifecycle ----------------------------------------------------

        async def on_enter(self) -> None:
            self._publish_state("ready")
            if self._repo is not None:
                self._repo.mark_in_progress(self._state.sessionId)
            try:
                await self._run_all_sections()
                self._publish_state("completed")
                if self._repo is not None:
                    self._persist_transcript()
                    self._repo.complete_session(
                        self._state.sessionId, collected_answers_map(self._state)
                    )
            except Exception as error:  # noqa: BLE001 - surface + persist failure
                self._log.error("interview failed", sessionId=self._state.sessionId, error=str(error))
                if self._repo is not None:
                    self._persist_transcript()
                    self._repo.fail_session(self._state.sessionId, {"message": str(error)})
                raise

        # -- section / question loop -------------------------------------

        async def _run_all_sections(self) -> None:
            for section in self._state.workflowConfig.sections:
                await self._run_section(section)

        async def _run_section(self, section: SectionTaskGroupConfig) -> None:
            self._log.info(
                "section started",
                sessionId=self._state.sessionId,
                sectionId=section.sectionId,
                questionCount=len(section.questions),
            )
            task_group = build_section_task_group(section, chat_ctx=self.chat_ctx)
            results = await self._run_task_group(task_group)
            self._record_section_results(section, results)
            if self._repo is not None:
                self._persist_transcript()

        async def _run_task_group(self, task_group: Any) -> dict[str, QuestionTaskResult]:
            """Run a section TaskGroup and return ``{task_id: QuestionTaskResult}``.

            LiveKit's beta workflow returns results keyed by the task id the
            group was built with (``question_<questionId>``). The attribute name
            has shifted across betas, so we read defensively.
            """
            run_result = await task_group.run()
            for attr in ("results", "task_results", "output"):
                candidate = getattr(run_result, attr, None) if run_result is not None else None
                if isinstance(candidate, dict):
                    return candidate
            if isinstance(run_result, dict):
                return run_result
            return {}

        def _record_section_results(
            self, section: SectionTaskGroupConfig, results: dict[str, QuestionTaskResult]
        ) -> None:
            for question in section.questions:
                task_id = f"question_{question.questionId}"
                result = results.get(task_id) or results.get(question.questionId)
                if result is None:
                    continue
                record_question_result(
                    self._state,
                    section_id=section.sectionId,
                    question_id=question.questionId,
                    result=result,
                )
                advance_to(
                    self._state,
                    section_id=section.sectionId,
                    question_id=question.questionId,
                )
            self._publish_state("completed" if is_complete(self._state) else "collecting")

        # -- side effects -------------------------------------------------

        def _persist_transcript(self) -> None:
            if self._repo is None or self._transcript is None or self._transcript.is_empty:
                return
            language = "zh"
            self._repo.save_transcript(
                self._state.sessionId, self._transcript.snapshot(), language
            )

        def _publish_state(self, status: str) -> None:
            payload = InterviewAgentState(
                status=status,
                currentSectionId=self._state.currentSectionId,
                currentQuestionId=self._state.currentQuestionTaskId,
                currentQuestion=None,
                updatedAt=_now_iso(),
            )
            try:
                self._room.local_participant.set_attributes(
                    {INTERVIEW_STATE_ATTRIBUTE: payload.model_dump_json()}
                )
            except Exception as error:  # noqa: BLE001 - attribute publish is best-effort
                self._log.warn("failed to publish agent state", error=str(error))

    return InterviewSupervisorAgent
