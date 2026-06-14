"""Unit tests for the pure interview workflow helpers."""
from __future__ import annotations

from agent.contracts import (
    InterviewRoomMetadata,
    InterviewRuntimeQuestion,
    InterviewRuntimeSection,
    InterviewRuntimeStudy,
    ProbeResult,
    ProbeRound,
    QuestionTaskResult,
)
from agent.interview.workflow import (
    collected_answers_map,
    completed_question_count,
    index_runtime_questions,
    initial_workflow_state,
    is_complete,
    record_question_result,
    total_question_count,
    workflow_config_from_metadata,
    workflow_config_from_study,
)
from agent.interview.tasks.question import build_question_instructions


def _choice_question(qid: str, options: list[str]) -> InterviewRuntimeQuestion:
    return InterviewRuntimeQuestion(
        questionId=qid,
        sectionId="sec1",
        sectionTitle="Background",
        orderInSection=0,
        questionText=f"Which for {qid}?",
        questionType="single_choice",
        probeLevel="standard",
        probeInstruction="",
        options=options,
        responseMode="single_select",
    )


def _question(qid: str, *, probe: str = "standard") -> InterviewRuntimeQuestion:
    return InterviewRuntimeQuestion(
        questionId=qid,
        sectionId="sec1",
        sectionTitle="Background",
        orderInSection=0,
        questionText=f"Tell me about {qid}",
        questionType="open_ended",
        probeLevel=probe,  # type: ignore[arg-type]
        probeInstruction="Dig deeper",
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
    study = _study(_question("q1", probe="deep"), _question("q2", probe="standard"))
    config = workflow_config_from_study(study, session_id="s1")

    assert config.sessionId == "s1"
    assert config.surveyId == "sv1"
    assert len(config.sections) == 1
    section = config.sections[0]
    # Every question is probed; deep allows more rounds than standard.
    assert section.questions[0].probeConfig is not None
    assert section.questions[0].probeConfig.level == "deep"
    assert section.questions[0].probeConfig.maxRounds == 5
    assert section.questions[1].probeConfig is not None
    assert section.questions[1].probeConfig.level == "standard"
    assert section.questions[1].probeConfig.maxRounds == 3


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
                rounds=[
                    ProbeRound(probeQuestion="Why two?", respondentAnswer="Long mornings"),
                    ProbeRound(probeQuestion="Always two?", respondentAnswer="Most days"),
                ],
            ),
        ),
    )
    assert is_complete(state)

    answers = collected_answers_map(state)
    assert set(answers.keys()) == {"q1", "q2"}
    assert answers["q1"]["answer"] == "I drink coffee"
    assert answers["q1"]["source"] == "voice"
    assert len(answers["q2"]["probe"]["rounds"]) == 2
    assert answers["q2"]["probe"]["rounds"][0]["probeQuestion"] == "Why two?"


def test_choice_options_preserved_into_task_config():
    # Structured-question fix: options must survive runtime -> QuestionTaskConfig
    # so the voice prompt can read them out.
    study = _study(_choice_question("q1", ["A", "B", "C"]))
    config = workflow_config_from_study(study, session_id="s1")
    task = config.sections[0].questions[0]
    assert task.questionId == "q1"
    assert task.options == ["A", "B", "C"]


def test_index_runtime_questions_maps_by_id():
    study = _study(_question("q1"), _choice_question("q2", ["X", "Y"]))
    index = index_runtime_questions(study)
    assert set(index) == {"q1", "q2"}
    # The full runtime question is preserved verbatim for publishing to the room.
    assert index["q2"].responseMode == "single_select"
    assert index["q2"].options == ["X", "Y"]


def test_build_question_instructions_lists_choice_options():
    study = _study(_choice_question("q1", ["Espresso", "Latte"]))
    task = workflow_config_from_study(study, session_id="s1").sections[0].questions[0]
    text = build_question_instructions(task)
    assert "Espresso" in text and "Latte" in text
    assert "options" in text.lower()


def test_build_question_instructions_open_ended_has_no_options_block():
    study = _study(_question("q1"))
    task = workflow_config_from_study(study, session_id="s1").sections[0].questions[0]
    text = build_question_instructions(task)
    assert "preset options" not in text


def test_should_accept_ui_answer_matches_cursor():
    from agent.interview.workflow import should_accept_ui_answer

    # accepted only when there is an active task and the id matches the cursor
    assert should_accept_ui_answer(
        submitted_question_id="q1", current_question_id="q1", has_active_task=True
    ) is True
    # mismatch (stale / out-of-order)
    assert should_accept_ui_answer(
        submitted_question_id="q2", current_question_id="q1", has_active_task=True
    ) is False
    # no active task
    assert should_accept_ui_answer(
        submitted_question_id="q1", current_question_id="q1", has_active_task=False
    ) is False
    # cursor not set yet
    assert should_accept_ui_answer(
        submitted_question_id="q1", current_question_id=None, has_active_task=True
    ) is False


def test_format_ui_answer_precedence():
    from agent.contracts import InterviewAnswerPayload
    from agent.interview.workflow import format_ui_answer

    def _ans(**kw) -> InterviewAnswerPayload:
        base = dict(questionId="q1", sectionId="s1", questionType="single_choice", source="ui")
        base.update(kw)
        return InterviewAnswerPayload(**base)  # type: ignore[arg-type]

    # free text wins
    assert format_ui_answer(_ans(text="  hello ", selectedOptions=["A"])) == "hello"
    # selected options (single/multi)
    assert format_ui_answer(_ans(selectedOptions=["A", "B"])) == "A, B"
    # ranking order
    assert format_ui_answer(_ans(ranking=["A", "B", "C"])) == "A > B > C"
    # integer score renders without trailing .0
    assert format_ui_answer(_ans(score=4)) == "4"
    # fractional score preserved
    assert format_ui_answer(_ans(score=4.5)) == "4.5"
    # nothing provided
    assert format_ui_answer(_ans()) == ""
