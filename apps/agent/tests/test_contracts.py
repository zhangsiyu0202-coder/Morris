import pytest

from agent.contracts import (
    InterviewAnswerPayload,
    InterviewRoomMetadata,
    InterviewRuntimeStudy,
    InterviewWorkflowConfig,
    InterviewWorkflowState,
    IssueLivekitTokenResponse,
    QuestionTaskConfig,
    QuestionTaskResult,
    SurveyDraft,
)
from agent.interview.runtime_bridge import runtime_questions_from_workflow
from agent.interview.tasks.question import build_question_instructions
from agent.logging import mask_secret
from agent.retry import (
    PermanentProviderError,
    TransientProviderError,
    with_retry,
)


def test_issue_token_response_roundtrip():
    r = IssueLivekitTokenResponse(
        sessionId="s1",
        livekitUrl="ws://localhost:7880",
        token="tok",
        surveyMeta={"surveyId": "sv1", "title": "T"},
    )
    assert r.surveyMeta.surveyId == "sv1"


def test_interview_workflow_state_defaults():
    config = InterviewWorkflowConfig(
        surveyId="sv1",
        sessionId="s1",
        supervisorInstruction="Guide the interview.",
        sections=[
            {
                "sectionId": "sec1",
                "title": "Concept reaction",
                "questions": [
                    {
                        "questionId": "q1",
                        "questionType": "text",
                        "questionContent": "What is your first reaction?",
                    }
                ],
            }
        ],
    )
    st = InterviewWorkflowState(sessionId="s1", surveyId="sv1", workflowConfig=config)
    assert st.sectionResults == {}
    assert st.transcriptBuffer == []


def test_question_task_result_minimal_shape():
    result = QuestionTaskResult(
        questionType="rating",
        questionContent="How likely are you to use this?",
        respondentAnswer="Probably four out of five.",
        probe=None,
    )
    assert result.probe is None


def test_survey_draft_shape_for_editor_runtime_bridge():
    draft = SurveyDraft(
        title="Retention study",
        researchGoal="Learn what keeps users active after signup.",
        targetAudience="Users active for 30-90 days.",
        introScript="Thanks for joining this interview.",
        sections=[
            {
                "title": "Opening",
                "objective": "Set context.",
                "questions": [
                    {
                        "questionText": "Tell me about your first month using the product.",
                        "questionType": "open_ended",
                        "probeLevel": "standard",
                        "probeInstruction": "Ask what moment made the product click.",
                    }
                ],
            }
        ],
    )
    assert draft.sections[0].questions[0].probeLevel == "standard"


def test_interview_runtime_study_shape_for_frontend_agent_bridge():
    runtime = InterviewRuntimeStudy(
        surveyId="survey-1",
        studyTitle="Retention study",
        researchGoal="Learn what keeps users active after signup.",
        targetAudience="Users active for 30-90 days.",
        introScript="Thanks for joining this interview.",
        sections=[
            {
                "sectionId": "section-1",
                "title": "Opening",
                "objective": "Set context.",
                "questions": [
                    {
                        "questionId": "question-1-1",
                        "sectionId": "section-1",
                        "sectionTitle": "Opening",
                        "orderInSection": 0,
                        "questionText": "Tell me about your first month using the product.",
                        "questionType": "open_ended",
                        "probeLevel": "standard",
                        "probeInstruction": "Ask what moment made the product click.",
                        "responseMode": "voice_only",
                    }
                ],
            }
        ],
    )
    assert runtime.sections[0].questions[0].responseMode == "voice_only"


def test_interview_answer_payload_supports_ui_answers():
    answer = InterviewAnswerPayload(
        questionId="question-1-2",
        sectionId="section-1",
        questionType="single_choice",
        source="ui",
        selectedOptions=["Option A"],
    )
    assert answer.selectedOptions == ["Option A"]


def test_runtime_questions_can_be_derived_from_workflow_config():
    metadata = InterviewRoomMetadata(
        sessionId="session-1",
        surveyId="survey-1",
        workflowConfig={
            "surveyId": "survey-1",
            "sessionId": "session-1",
            "supervisorInstruction": "Guide the interview.",
            "sections": [
                {
                    "sectionId": "section-1",
                    "title": "Opening",
                    "questions": [
                        {
                            "questionId": "question-1",
                            "questionType": "text",
                            "questionContent": "Tell me about your last experience.",
                        }
                    ],
                }
            ],
        },
    )
    questions = runtime_questions_from_workflow(metadata)
    assert questions[0].responseMode == "voice_only"
    assert questions[0].questionType == "open_ended"


def test_question_instructions_include_probe_only_when_configured():
    plain = QuestionTaskConfig(
        questionId="q1",
        questionType="text",
        questionContent="What is your first reaction?",
    )
    probed = QuestionTaskConfig(
        questionId="q2",
        questionType="text",
        questionContent="Why did you react that way?",
        probeConfig={
            "level": "standard",
            "instruction": "Ask for a concrete example if needed.",
            "maxRounds": 3,
        },
    )

    assert "Probe instructions" not in build_question_instructions(plain)
    assert "Probe level: standard" in build_question_instructions(probed)


def test_mask_secret_hides_value():
    assert mask_secret("supersecretvalue") == "supe***"


def test_with_retry_retries_transient_then_succeeds():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise TransientProviderError("rate limited")
        return "ok"

    assert with_retry(flaky, max_attempts=3, sleep=lambda _: None) == "ok"
    assert calls["n"] == 3


def test_with_retry_never_retries_permanent():
    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        raise PermanentProviderError("bad key")

    with pytest.raises(PermanentProviderError):
        with_retry(boom, sleep=lambda _: None)
    assert calls["n"] == 1
