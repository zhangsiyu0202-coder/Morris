"""Unit tests for the pure interview workflow helpers."""
from __future__ import annotations

from agent.contracts import (
    InterviewRoomMetadata,
    InterviewRuntimeQuestion,
    InterviewRuntimeSection,
    InterviewRuntimeStudy,
    ProbeResult,
    QuestionTaskResult,
)
from agent.interview.workflow import (
    collected_answers_map,
    completed_question_count,
    initial_workflow_state,
    is_complete,
    record_question_result,
    total_question_count,
    workflow_config_from_metadata,
    workflow_config_from_study,
)


def _question(qid: str, *, probe: str = "none") -> InterviewRuntimeQuestion:
    return InterviewRuntimeQuestion(
        questionId=qid,
        sectionId="sec1",
        sectionTitle="Background",
        orderInSection=0,
        questionText=f"Tell me about {qid}",
        questionType="open_ended",
        probeLevel=probe,  # type: ignore[arg-type]
        probeInstruction="Dig deeper" if probe != "none" else "",
        options=[],
        responseMode="voice_only",
    )


def _study(*questions: InterviewRuntimeQuestion) -> InterviewRuntimeStudy:
    return InterviewRuntimeStudy(
        surveyId="sv1",
        studyTitle="Coffee habits",
        researchGoal="Understand morning routines",
        targetAudience="Office workers",
        introScript="Welcome!",
        sections=[
            InterviewRuntimeSection(
                sectionId="sec1",
                title="Background",
                objective="Warm up",
                questions=list(questions),
            )
        ],
    )


def test_workflow_config_from_study_maps_probe_levels():
    study = _study(_question("q1", probe="deep"), _question("q2", probe="none"))
    config = workflow_config_from_study(study, session_id="s1")

    assert config.sessionId == "s1"
    assert config.surveyId == "sv1"
    assert len(config.sections) == 1
    section = config.sections[0]
    assert section.questions[0].probeConfig is not None
    assert section.questions[0].probeConfig.level == "deep"
    # "none" probe level produces no probe config
    assert section.questions[1].probeConfig is None


def test_workflow_config_from_metadata_prefers_explicit_config():
    study = _study(_question("q1"))
    config = workflow_config_from_study(study, session_id="s1")
    metadata = InterviewRoomMetadata(sessionId="s1", surveyId="sv1", workflowConfig=config)
    assert workflow_config_from_metadata(metadata) is config


def test_workflow_config_from_metadata_derives_from_runtime_study():
    study = _study(_question("q1"))
    metadata = InterviewRoomMetadata(sessionId="s9", surveyId="sv1", runtimeStudy=study)
    resolved = workflow_config_from_metadata(metadata)
    assert resolved is not None
    assert resolved.sessionId == "s9"


def test_workflow_config_from_metadata_returns_none_when_empty():
    metadata = InterviewRoomMetadata(sessionId="s1", surveyId="sv1")
    assert workflow_config_from_metadata(metadata) is None


def test_initial_state_positions_cursor_at_first_question():
    config = workflow_config_from_study(_study(_question("q1"), _question("q2")), session_id="s1")
    state = initial_workflow_state(config)
    assert state.currentSectionId == "sec1"
    assert state.currentQuestionTaskId == "q1"
    assert completed_question_count(state) == 0
    assert total_question_count(config) == 2
    assert not is_complete(state)


def test_recording_results_drives_completion_and_answers_map():
    config = workflow_config_from_study(_study(_question("q1"), _question("q2", probe="deep")), session_id="s1")
    state = initial_workflow_state(config)

    record_question_result(
        state,
        section_id="sec1",
        question_id="q1",
        result=QuestionTaskResult(
            questionType="open_ended",
            questionContent="Tell me about q1",
            respondentAnswer="I drink coffee",
        ),
    )
    assert not is_complete(state)

    record_question_result(
        state,
        section_id="sec1",
        question_id="q2",
        result=QuestionTaskResult(
            questionType="open_ended",
            questionContent="Tell me about q2",
            respondentAnswer="Two cups",
            probe=ProbeResult(
                level="deep",
                probeInstruction="Dig deeper",
                probeQuestion="Why two?",
                respondentAnswer="Long mornings",
            ),
        ),
    )
    assert is_complete(state)

    answers = collected_answers_map(state)
    assert set(answers.keys()) == {"q1", "q2"}
    assert answers["q1"]["answer"] == "I drink coffee"
    assert answers["q1"]["source"] == "voice"
    assert answers["q2"]["probe"]["probeQuestion"] == "Why two?"
