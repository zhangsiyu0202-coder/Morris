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

import time
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from agent.contracts import (
    INTERVIEW_STATE_ATTRIBUTE,
    SUBMIT_ANSWER_RPC_METHOD,
    InterviewAgentState,
    InterviewRuntimeQuestion,
    InterviewWorkflowState,
    QuestionTaskResult,
    SectionTaskGroupConfig,
    SubmitInterviewAnswerRpcRequest,
    SubmitInterviewAnswerRpcResponse,
)
from agent.interview.task_group_builder import build_section_task_group
from agent.interview.workflow import (
    advance_to,
    collected_answers_map,
    is_complete,
    record_question_result,
    should_accept_ui_answer,
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
            egress_recorder: Any | None = None,
            runtime_questions: Mapping[str, InterviewRuntimeQuestion] | None = None,
        ) -> None:
            self._room = room
            self._state = state
            self._transcript = transcript
            self._repo = repository
            self._log = logger
            self._egress = egress_recorder
            # questionId -> full runtime question, published to the room so the
            # interviewee portal renders the structured control for this question.
            self._runtime_questions = dict(runtime_questions or {})
            # Handle to the question task currently being asked, so a UI click
            # (submit_answer RPC) can complete it from outside the model loop.
            self._active_question_task: Any | None = None
            super().__init__(instructions=state.workflowConfig.supervisorInstruction)

        # -- lifecycle ----------------------------------------------------

        async def on_enter(self) -> None:
            started_monotonic = time.monotonic()
            self._register_submit_answer_rpc()
            self._publish_state("ready")
            if self._repo is not None:
                self._repo.mark_in_progress(self._state.sessionId)
            try:
                await self._run_all_sections()
                self._publish_state("completed")
                if self._repo is not None:
                    self._persist_transcript()
                    await self._persist_recording()
                    answers = collected_answers_map(self._state)
                    self._repo.complete_session(self._state.sessionId, answers)
                    # ADR-0006 D6: emit the billable UsageEvent for a completed
                    # interview. Idempotent + threshold-gated inside the repo.
                    duration_ms = int((time.monotonic() - started_monotonic) * 1000)
                    answered_count = sum(1 for a in answers.values() if a.get("answer"))
                    self._repo.emit_usage_event(
                        self._state.sessionId,
                        self._state.surveyId,
                        duration_ms=duration_ms,
                        answered_count=answered_count,
                    )
                    # ADR-0003 D1+D4: chain analyzeSession -> analyzeSurvey on
                    # completion. Failures are logged inside the repository
                    # method and never raised back to the supervisor.
                    self._repo.trigger_post_session_analysis(
                        self._state.sessionId, self._state.surveyId
                    )
            except Exception as error:  # noqa: BLE001 - surface + persist failure
                self._log.error("interview failed", sessionId=self._state.sessionId, error=str(error))
                if self._repo is not None:
                    self._persist_transcript()
                    await self._persist_recording()
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
            task_group = build_section_task_group(
                section, chat_ctx=self.chat_ctx, on_question_enter=self._on_question_enter
            )
            results = await self._run_task_group(task_group)
            self._record_section_results(section, results)
            if self._repo is not None:
                self._persist_transcript()

        def _on_question_enter(self, question_id: str, task: Any) -> None:
            """Publish the current question to the room when its task starts (so
            the interviewee portal renders the structured control), and hold a
            handle to the task so a UI click can complete it."""
            self._state.currentQuestionTaskId = question_id
            self._active_question_task = task
            runtime_question = self._runtime_questions.get(question_id)
            if runtime_question is not None:
                self._state.currentSectionId = runtime_question.sectionId
            self._publish_state("collecting")

        # -- structured answer over RPC ----------------------------------

        def _register_submit_answer_rpc(self) -> None:
            """Listen for UI-submitted structured answers. The voice path does
            not run the runtime bridge (they are mutually exclusive in
            main.py), so this is the only submit_answer handler in voice mode."""
            try:
                self._room.local_participant.register_rpc_method(
                    SUBMIT_ANSWER_RPC_METHOD, self._handle_submit_answer
                )
            except Exception as error:  # noqa: BLE001 - registration is best-effort
                self._log.warn("failed to register submit_answer rpc", error=str(error))

        async def _handle_submit_answer(self, data: Any) -> str:
            request = SubmitInterviewAnswerRpcRequest.model_validate_json(data.payload)
            current_id = self._state.currentQuestionTaskId
            task = self._active_question_task

            # Only the question currently being asked may be answered by a click;
            # a mismatch is a stale / duplicate / out-of-order submit.
            if not should_accept_ui_answer(
                submitted_question_id=request.answer.questionId,
                current_question_id=current_id,
                has_active_task=task is not None,
            ):
                self._log.warn(
                    "interview answer rejected: questionId does not match active question",
                    submittedQuestionId=request.answer.questionId,
                    currentQuestionId=current_id,
                    source=request.answer.source,
                )
                return SubmitInterviewAnswerRpcResponse(
                    accepted=False, nextQuestionId=current_id, completed=False
                ).model_dump_json()

            # First-writer-wins: returns False if the model already completed
            # this question by voice (the voice answer stands).
            accepted = task.complete_with_ui_answer(request.answer)
            if not accepted:
                return SubmitInterviewAnswerRpcResponse(
                    accepted=False, nextQuestionId=current_id, completed=False
                ).model_dump_json()

            self._log.info(
                "interview answer accepted from ui",
                questionId=request.answer.questionId,
                source=request.answer.source,
            )
            # The completed task lets the TaskGroup advance; the supervisor then
            # publishes the next question's state. The client renders from that
            # authoritative attribute, so nextQuestionId is left for the publish.
            return SubmitInterviewAnswerRpcResponse(
                accepted=True, nextQuestionId=None, completed=False
            ).model_dump_json()

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
            owner_user_id, workspace_id = self._repo.resolve_survey_tenancy(self._state.surveyId)
            self._repo.save_transcript(
                self._state.sessionId,
                self._transcript.snapshot(),
                language,
                owner_user_id=owner_user_id,
                workspace_id=workspace_id,
            )

        async def _persist_recording(self) -> None:
            if self._repo is None or self._egress is None:
                return
            artifact = await self._egress.finalize(session_id=self._state.sessionId)
            if artifact is None:
                return
            owner_user_id, workspace_id = self._repo.resolve_survey_tenancy(self._state.surveyId)
            if owner_user_id is None:
                self._log.warn(
                    "recording skipped: could not resolve ownerUserId",
                    sessionId=self._state.sessionId,
                    surveyId=self._state.surveyId,
                )
                return
            self._repo.save_recording(
                self._state.sessionId,
                owner_user_id=owner_user_id,
                workspace_id=workspace_id,
                file_bytes=artifact.data,
                duration_ms=artifact.duration_ms,
                format=artifact.format,
            )

        def _publish_state(self, status: str) -> None:
            current_question = self._runtime_questions.get(self._state.currentQuestionTaskId or "")
            payload = InterviewAgentState(
                status=status,
                currentSectionId=self._state.currentSectionId,
                currentQuestionId=self._state.currentQuestionTaskId,
                currentQuestion=current_question,
                updatedAt=_now_iso(),
            )
            try:
                self._room.local_participant.set_attributes(
                    {INTERVIEW_STATE_ATTRIBUTE: payload.model_dump_json()}
                )
            except Exception as error:  # noqa: BLE001 - attribute publish is best-effort
                self._log.warn("failed to publish agent state", error=str(error))

    return InterviewSupervisorAgent
