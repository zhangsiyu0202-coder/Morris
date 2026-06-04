"""Bridge editor-derived workflow config to LiveKit room state and RPC."""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, cast

from agent.contracts import (
    INTERVIEW_STATE_ATTRIBUTE,
    SUBMIT_ANSWER_RPC_METHOD,
    InterviewAgentState,
    InterviewRoomMetadata,
    InterviewRuntimeQuestion,
    InterviewRuntimeStudy,
    QuestionTaskConfig,
    SectionTaskGroupConfig,
    StudyProbeLevel,
    SubmitInterviewAnswerRpcRequest,
    SubmitInterviewAnswerRpcResponse,
)

QuestionTypeToResponseMode = {
    "open_ended": "voice_only",
    "single_choice": "single_select",
    "multi_choice": "multi_select",
    "rating": "scale",
    "nps": "scale",
    "ranking": "ranking",
    "text": "voice_only",
    "info": "voice_only",
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _probe_level_from_task(question: QuestionTaskConfig) -> StudyProbeLevel:
    if question.probeConfig is not None and question.probeConfig.level == "deep":
        return "deep"
    return "standard"


def runtime_questions_from_workflow(
    metadata: InterviewRoomMetadata,
) -> list[InterviewRuntimeQuestion]:
    if metadata.runtimeStudy is not None:
        return [
            question
            for section in metadata.runtimeStudy.sections
            for question in section.questions
        ]

    if metadata.workflowConfig is None:
        return []

    runtime_questions: list[InterviewRuntimeQuestion] = []
    for section in metadata.workflowConfig.sections:
        runtime_questions.extend(_questions_from_section(section))
    return runtime_questions


def _questions_from_section(section: SectionTaskGroupConfig) -> list[InterviewRuntimeQuestion]:
    questions: list[InterviewRuntimeQuestion] = []
    for index, question in enumerate(section.questions):
        question_type = cast(
            "Any",
            question.questionType if question.questionType not in {"text", "info"} else "open_ended",
        )
        questions.append(
            InterviewRuntimeQuestion(
                questionId=question.questionId,
                sectionId=section.sectionId,
                sectionTitle=section.title,
                orderInSection=index,
                questionText=question.questionContent,
                questionType=question_type,
                probeLevel=_probe_level_from_task(question),
                probeInstruction=question.probeConfig.instruction if question.probeConfig else "",
                options=[],
                responseMode=QuestionTypeToResponseMode[question.questionType],
                stimulus=question.stimulus,
            )
        )
    return questions


class InterviewRuntimeBridge:
    def __init__(self, room: Any, metadata: InterviewRoomMetadata, logger: Any) -> None:
        self.room = room
        self.metadata = metadata
        self.logger = logger
        self.questions = runtime_questions_from_workflow(metadata)
        self.question_index = 0
        self.answers: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    def current_question(self) -> InterviewRuntimeQuestion | None:
        if self.question_index >= len(self.questions):
            return None
        return self.questions[self.question_index]

    def _publish_state(self, status: str, question: InterviewRuntimeQuestion | None) -> None:
        payload = InterviewAgentState(
            status=status,
            currentSectionId=question.sectionId if question else None,
            currentQuestionId=question.questionId if question else None,
            currentQuestion=question,
            updatedAt=_now_iso(),
        )
        self.room.local_participant.set_attributes(
            {INTERVIEW_STATE_ATTRIBUTE: payload.model_dump_json()}
        )

    async def start(self) -> None:
        self.room.local_participant.register_rpc_method(
            SUBMIT_ANSWER_RPC_METHOD, self._handle_submit_answer
        )
        self._publish_state("ready" if self.questions else "idle", self.current_question())
        self.logger.info(
            "runtime bridge started",
            questionCount=len(self.questions),
            sessionId=self.metadata.sessionId,
        )

    async def _handle_submit_answer(self, data: Any) -> str:
        request = SubmitInterviewAnswerRpcRequest.model_validate_json(data.payload)

        async with self._lock:
            current = self.current_question()
            if current is None:
                response = SubmitInterviewAnswerRpcResponse(
                    nextQuestionId=None,
                    completed=True,
                )
                return response.model_dump_json()

            self.logger.info(
                "interview answer received",
                questionId=request.answer.questionId,
                source=request.answer.source,
            )
            self.answers[request.answer.questionId] = request.answer
            self.question_index += 1
            next_question = self.current_question()

            if next_question is None:
                self._publish_state("completed", None)
                response = SubmitInterviewAnswerRpcResponse(
                    nextQuestionId=None,
                    completed=True,
                )
            else:
                self._publish_state("ready", next_question)
                response = SubmitInterviewAnswerRpcResponse(
                    nextQuestionId=next_question.questionId,
                    completed=False,
                )

            return response.model_dump_json()

