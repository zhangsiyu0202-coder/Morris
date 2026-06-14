"""Tests for the UI-only RPC bridge cursor guard.

The bridge advances the interview only when a submitted answer's questionId
matches the agent's authoritative cursor (the published currentQuestion). A
mismatch is a stale / duplicate / out-of-order submit and must be rejected
without moving the cursor or recording the answer — mirroring Typebot's "a
reply only counts for the input the server is currently on".
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from agent.contracts import (
    InterviewAnswerPayload,
    InterviewRoomMetadata,
    InterviewRuntimeQuestion,
    InterviewRuntimeSection,
    InterviewRuntimeStudy,
    SubmitInterviewAnswerRpcRequest,
    SubmitInterviewAnswerRpcResponse,
)
from agent.interview.runtime_bridge import InterviewRuntimeBridge


class _FakeLocalParticipant:
    def __init__(self) -> None:
        self.attributes: dict[str, str] = {}
        self.publish_count = 0
        self.rpc_methods: dict[str, object] = {}

    def set_attributes(self, attrs: dict[str, str]) -> None:
        self.attributes.update(attrs)
        self.publish_count += 1

    def register_rpc_method(self, method: str, handler: object) -> None:
        self.rpc_methods[method] = handler


class _FakeRoom:
    def __init__(self) -> None:
        self.local_participant = _FakeLocalParticipant()


class _FakeLogger:
    def info(self, *_args, **_kwargs) -> None:
        pass

    def warn(self, *_args, **_kwargs) -> None:
        pass


def _question(qid: str) -> InterviewRuntimeQuestion:
    return InterviewRuntimeQuestion(
        questionId=qid,
        sectionId="sec1",
        sectionTitle="Background",
        orderInSection=0,
        questionText=f"Pick for {qid}",
        questionType="single_choice",
        probeLevel="standard",
        probeInstruction="",
        options=["A", "B"],
        responseMode="single_select",
    )


def _metadata(*qids: str) -> InterviewRoomMetadata:
    return InterviewRoomMetadata(
        sessionId="s1",
        surveyId="sv1",
        runtimeStudy=InterviewRuntimeStudy(
            surveyId="sv1",
            studyTitle="T",
            researchGoal="G",
            targetAudience="A",
            introScript="Hi",
            sections=[
                InterviewRuntimeSection(
                    sectionId="sec1",
                    title="Background",
                    objective="Warm up",
                    questions=[_question(q) for q in qids],
                )
            ],
        ),
    )


def _answer(qid: str, source: str = "ui") -> InterviewAnswerPayload:
    return InterviewAnswerPayload(
        questionId=qid,
        sectionId="sec1",
        questionType="single_choice",
        source=source,  # type: ignore[arg-type]
        selectedOptions=["A"],
    )


def _rpc_data(answer: InterviewAnswerPayload) -> SimpleNamespace:
    payload = SubmitInterviewAnswerRpcRequest(answer=answer).model_dump_json()
    return SimpleNamespace(payload=payload)


def _submit(bridge: InterviewRuntimeBridge, answer: InterviewAnswerPayload) -> SubmitInterviewAnswerRpcResponse:
    raw = asyncio.run(bridge._handle_submit_answer(_rpc_data(answer)))
    return SubmitInterviewAnswerRpcResponse.model_validate(json.loads(raw))


def test_matching_answer_advances_and_is_accepted():
    bridge = InterviewRuntimeBridge(_FakeRoom(), _metadata("q1", "q2"), _FakeLogger())

    res = _submit(bridge, _answer("q1"))

    assert res.accepted is True
    assert res.completed is False
    assert res.nextQuestionId == "q2"
    assert bridge.question_index == 1
    assert "q1" in bridge.answers


def test_mismatched_questionId_is_rejected_without_side_effects():
    bridge = InterviewRuntimeBridge(_FakeRoom(), _metadata("q1", "q2"), _FakeLogger())
    publishes_before = bridge.room.local_participant.publish_count  # bridge not started → 0

    res = _submit(bridge, _answer("q2"))  # answering the future question

    assert res.accepted is False
    assert res.completed is False
    assert res.nextQuestionId == "q1"  # echoes the question still in play
    # Cursor and recorded answers untouched; no state republished.
    assert bridge.question_index == 0
    assert bridge.answers == {}
    assert bridge.room.local_participant.publish_count == publishes_before


def test_duplicate_submit_after_advance_is_rejected_idempotent():
    bridge = InterviewRuntimeBridge(_FakeRoom(), _metadata("q1", "q2"), _FakeLogger())

    first = _submit(bridge, _answer("q1"))
    assert first.accepted is True
    assert bridge.question_index == 1

    # A late duplicate of the same q1 answer now targets the previous question.
    dup = _submit(bridge, _answer("q1"))
    assert dup.accepted is False
    assert bridge.question_index == 1  # not advanced twice
    assert list(bridge.answers) == ["q1"]


def test_answer_after_completion_is_rejected():
    bridge = InterviewRuntimeBridge(_FakeRoom(), _metadata("q1"), _FakeLogger())

    done = _submit(bridge, _answer("q1"))
    assert done.accepted is True
    assert done.completed is True
    assert bridge.current_question() is None

    extra = _submit(bridge, _answer("q1"))
    assert extra.accepted is False
    assert extra.completed is True
