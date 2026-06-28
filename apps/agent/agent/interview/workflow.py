"""Pure interview workflow helpers (no livekit / appwrite imports).

These functions own the *correctness* of the Supervisor workflow:
- deriving an ``InterviewWorkflowConfig`` from room metadata,
- advancing ``InterviewWorkflowState`` as question tasks complete,
- projecting collected results into the shape persisted on the session.

Keeping them side-effect free makes the workflow unit/property testable without
the realtime stack. The engine (engine.py) drives livekit and delegates all
state transitions here.
"""
from __future__ import annotations

from typing import cast

from agent.contracts import (
    InterviewAnswerPayload,
    InterviewRoomMetadata,
    InterviewRuntimeQuestion,
    InterviewRuntimeSection,
    InterviewRuntimeStudy,
    InterviewWorkflowConfig,
    InterviewWorkflowState,
    ProbeConfig,
    ProbeLevel,
    QuestionTaskConfig,
    QuestionTaskResult,
    QuestionType,
    SectionTaskGroupConfig,
    SectionTaskGroupResult,
    StudyProbeLevel,
)

# Default probe-round ceilings per depth. Every question is probed; the only
# choice is how deep. The authoritative control is maxRounds itself.
_PROBE_DEFAULT_MAX_ROUNDS: dict[StudyProbeLevel, int] = {
    "standard": 3,
    "deep": 5,
}


def _probe_config_from_study(level: StudyProbeLevel, instruction: str) -> ProbeConfig:
    return ProbeConfig(
        level=cast(ProbeLevel, level),
        instruction=instruction,
        maxRounds=_PROBE_DEFAULT_MAX_ROUNDS[level],
    )


def _section_config_from_runtime(section: InterviewRuntimeSection) -> SectionTaskGroupConfig:
    questions = [
        QuestionTaskConfig(
            questionId=question.questionId,
            questionType=cast(QuestionType, question.questionType),
            questionContent=question.questionText,
            options=list(question.options),
            probeConfig=_probe_config_from_study(question.probeLevel, question.probeInstruction),
            stimulus=question.stimulus,
        )
        for question in section.questions
    ]
    return SectionTaskGroupConfig(
        sectionId=section.sectionId,
        title=section.title,
        description=section.objective,
        sectionInstruction=section.objective or None,
        questions=questions,
    )


def index_runtime_questions(
    study: InterviewRuntimeStudy,
) -> dict[str, InterviewRuntimeQuestion]:
    """Map every runtime question by its ``questionId`` (pure).

    The Supervisor publishes the current question to the room so the interviewee
    portal can render the structured control (single/multi/scale/ranking). The
    full ``InterviewRuntimeQuestion`` (text + type + options + responseMode +
    stimulus) is exactly the shape the renderer consumes, so it is published
    verbatim rather than reconstructed.
    """
    return {
        question.questionId: question
        for section in study.sections
        for question in section.questions
    }


def should_accept_ui_answer(
    *,
    submitted_question_id: str,
    current_question_id: str | None,
    has_active_task: bool,
) -> bool:
    """Whether a UI-submitted answer may complete the current question (pure).

    A click only counts for the question the agent is currently on: there must
    be an active question task and the submitted questionId must match the live
    cursor. Mismatches are stale / duplicate / out-of-order submits. Mirrors the
    bridge-path guard so both answer paths honor the same authoritative cursor.
    """
    return (
        has_active_task
        and current_question_id is not None
        and submitted_question_id == current_question_id
    )


def format_ui_answer(answer: InterviewAnswerPayload) -> str:
    """Render a UI-submitted structured answer as the human-readable string
    stored in ``QuestionTaskResult.respondentAnswer`` (pure).

    Precedence matches the response modes: free text, then selected options
    (single/multi), then a ranking order, then a numeric score (scale/nps).
    """
    if answer.text.strip():
        return answer.text.strip()
    if answer.selectedOptions:
        return ", ".join(answer.selectedOptions)
    if answer.ranking:
        return " > ".join(answer.ranking)
    if answer.score is not None:
        score = answer.score
        return str(int(score)) if float(score).is_integer() else str(score)
    return ""


def _supervisor_instruction_from_study(study: InterviewRuntimeStudy) -> str:
    return (
        f"You are an AI qualitative interviewer for the study \"{study.studyTitle}\".\n"
        f"Research goal: {study.researchGoal}\n"
        f"Target audience: {study.targetAudience}\n"
        f"Opening script: {study.introScript}\n"
        "Conduct the interview section by section, keep it conversational, ask the "
        "configured probes only when a question has probe guidance, and never reveal "
        "internal task or section identifiers.\n"
        "IMPORTANT speaking rules:\n"
        "- Speak only the words the respondent should hear. Never read out stage "
        "directions in parentheses (e.g. \"(等待受访者回答后, 进行追问)\", "
        "\"(等待回答)\"); those are notes for you, not lines to deliver.\n"
        "- Do not narrate your own transitions (\"接下来我会问下一题\"); just ask "
        "the next question naturally."
    )


def workflow_config_from_study(study: InterviewRuntimeStudy, *, session_id: str) -> InterviewWorkflowConfig:
    """Build a Supervisor workflow config from an editor-derived runtime study."""
    return InterviewWorkflowConfig(
        surveyId=study.surveyId,
        sessionId=session_id,
        supervisorInstruction=_supervisor_instruction_from_study(study),
        sections=[_section_config_from_runtime(section) for section in study.sections],
    )


def workflow_config_from_metadata(metadata: InterviewRoomMetadata) -> InterviewWorkflowConfig | None:
    """Resolve the workflow config from room metadata.

    Prefers an explicit ``workflowConfig``; otherwise derives one from
    ``runtimeStudy``. Returns ``None`` when neither is present.
    """
    if metadata.workflowConfig is not None:
        return metadata.workflowConfig
    if metadata.runtimeStudy is not None:
        return workflow_config_from_study(metadata.runtimeStudy, session_id=metadata.sessionId)
    return None


def initial_workflow_state(config: InterviewWorkflowConfig) -> InterviewWorkflowState:
    """Create the starting workflow state positioned at the first question."""
    first_section = config.sections[0] if config.sections else None
    first_question = (
        first_section.questions[0]
        if first_section and first_section.questions
        else None
    )
    return InterviewWorkflowState(
        sessionId=config.sessionId,
        surveyId=config.surveyId,
        workflowConfig=config,
        currentSectionId=first_section.sectionId if first_section else None,
        currentQuestionTaskId=first_question.questionId if first_question else None,
    )


def record_question_result(
    state: InterviewWorkflowState,
    *,
    section_id: str,
    question_id: str,
    result: QuestionTaskResult,
) -> InterviewWorkflowState:
    """Store one question task result into the section results map (in place)."""
    section_result = state.sectionResults.get(section_id)
    if section_result is None:
        section_result = SectionTaskGroupResult(sectionId=section_id, questionResults={})
        state.sectionResults[section_id] = section_result
    section_result.questionResults[question_id] = result
    return state


def advance_to(
    state: InterviewWorkflowState,
    *,
    section_id: str | None,
    question_id: str | None,
) -> InterviewWorkflowState:
    """Move the cursor to a specific section/question (in place)."""
    state.currentSectionId = section_id
    state.currentQuestionTaskId = question_id
    return state


def total_question_count(config: InterviewWorkflowConfig) -> int:
    return sum(len(section.questions) for section in config.sections)


def completed_question_count(state: InterviewWorkflowState) -> int:
    return sum(len(result.questionResults) for result in state.sectionResults.values())


def is_complete(state: InterviewWorkflowState) -> bool:
    """True when every configured question has a recorded result."""
    return completed_question_count(state) >= total_question_count(state.workflowConfig)


def collected_answers_map(state: InterviewWorkflowState) -> dict[str, dict[str, object]]:
    """Project recorded results into the InterviewSession.collectedAnswers JSON.

    Keyed by questionId so it can be merged with UI-submitted answers and read
    back by the analysis module.
    """
    answers: dict[str, dict[str, object]] = {}
    for section_result in state.sectionResults.values():
        for question_id, result in section_result.questionResults.items():
            entry: dict[str, object] = {
                "sectionId": section_result.sectionId,
                "questionType": result.questionType,
                "questionContent": result.questionContent,
                "answer": result.respondentAnswer,
                "source": "voice",
            }
            if result.probe is not None:
                entry["probe"] = {
                    "level": result.probe.level,
                    "probeInstruction": result.probe.probeInstruction,
                    "rounds": [
                        {
                            "probeQuestion": round_.probeQuestion,
                            "answer": round_.respondentAnswer,
                        }
                        for round_ in result.probe.rounds
                    ],
                }
            answers[question_id] = entry
    return answers
