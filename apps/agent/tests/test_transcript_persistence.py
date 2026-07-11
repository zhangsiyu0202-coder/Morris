"""Unit tests for the transcript collector, serializers, and repository."""
from __future__ import annotations

import json

from agent.contracts import TranscriptSegment
from agent.interview.transcript import (
    SPEAKER_AGENT,
    SPEAKER_INTERVIEWEE,
    TranscriptCollector,
)
from agent.persistence.appwrite_repository import InterviewRepository, _FunctionsAdapter
from agent.persistence.serializers import (
    SESSIONS_COLLECTION_ID,
    session_failure_fields,
    session_progress_fields,
)


class _SilentLogger:
    def info(self, *a, **k): ...
    def warn(self, *a, **k): ...
    def error(self, *a, **k): ...


class _FakeDatabases:
    """Records create/update calls and can be told to raise."""

    def __init__(self, fail_create: bool = False) -> None:
        self.created: list[tuple] = []
        self.updated: list[tuple] = []
        self._fail_create = fail_create

    def create_document(self, database_id, collection_id, document_id, data, permissions=None):
        if self._fail_create:
            raise RuntimeError("create not allowed")
        self.created.append((database_id, collection_id, document_id, dict(data), permissions))
        return {"$id": document_id}

    def update_document(self, database_id, collection_id, document_id, data, permissions=None):
        self.updated.append((database_id, collection_id, document_id, dict(data), permissions))
        return {"$id": document_id}


# -- TranscriptCollector ------------------------------------------------------


def test_transcript_collector_skips_blank_and_clamps_timing():
    c = TranscriptCollector()
    assert c.is_empty
    assert c.add(speaker=SPEAKER_AGENT, start_ms=-50, end_ms=-10, text="  Hello  ") is not None
    assert c.add(speaker=SPEAKER_INTERVIEWEE, start_ms=100, end_ms=10, text="   ") is None
    segs = c.snapshot()
    assert len(segs) == 1
    assert segs[0].text == "Hello"
    assert segs[0].startMs == 0
    assert segs[0].endMs >= segs[0].startMs


def test_transcript_add_segment_filters_blank():
    c = TranscriptCollector()
    c.add_segment(TranscriptSegment(speaker="agent", startMs=0, endMs=1, text=""))
    assert c.is_empty


# -- serializers --------------------------------------------------------------


def test_session_field_builders():
    progress = session_progress_fields(state="in_progress", started_at="t")
    assert progress == {"state": "in_progress", "startedAt": "t"}

    failure = session_failure_fields(error_context={"message": "boom"}, ended_at="t")
    assert failure["state"] == "failed"
    assert json.loads(failure["errorContext"])["message"] == "boom"


# -- repository ---------------------------------------------------------------


def test_repository_writes_session_lifecycle():
    db = _FakeDatabases()
    repo = InterviewRepository(db, _SilentLogger())

    repo.mark_in_progress("s1")

    assert len(db.updated) == 1
    assert db.updated[0][1] == SESSIONS_COLLECTION_ID
    assert db.updated[0][3]["state"] == "in_progress"


def test_repository_swallows_persistence_errors():
    class _AlwaysFails:
        def create_document(self, *a, **k):
            raise RuntimeError("down")

        def update_document(self, *a, **k):
            raise RuntimeError("down")

    repo = InterviewRepository(_AlwaysFails(), _SilentLogger())
    # Should not raise -- persistence failures must not kill the live interview.
    repo.mark_in_progress("s1")


class _FakeFunctions:
    """Records create_execution calls and can be told to raise per call."""

    def __init__(self, fail_on: list[str] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self._fail_on = fail_on or []

    def create_execution(self, function_id: str, body: str):
        self.calls.append((function_id, body))
        if function_id in self._fail_on:
            raise RuntimeError(f"function {function_id} failed")
        return {"$id": "exec-1"}


def test_finalize_session_dispatches_function_with_final_artifacts():
    db = _FakeDatabases()
    fns = _FakeFunctions()
    repo = InterviewRepository(db, _SilentLogger(), fns)

    repo.finalize_session(
        "sess1",
        "sv1",
        collected_answers={"q1": {"answer": "yes"}},
        state="completed",
        transcript_segments=[
            TranscriptSegment(speaker="respondent", startMs=0, endMs=10, text="yes")
        ],
        recording={
            "ownerUserId": "owner1",
            "workspaceId": "ws1",
            "storageFileId": "sess1",
            "durationMs": 90_000,
            "format": "mp4",
        },
        duration_ms=90_000,
        answered_count=1,
    )

    assert len(fns.calls) == 1
    assert fns.calls[0][0] == "finalizeInterviewSession"
    assert json.loads(fns.calls[0][1]) == {
        "sessionId": "sess1",
        "surveyId": "sv1",
        "state": "completed",
        "collectedAnswers": {"q1": {"answer": "yes"}},
        "transcript": {
            "segments": [
                {"speaker": "respondent", "startMs": 0, "endMs": 10, "text": "yes"}
            ],
            "language": "zh",
        },
        "recording": {
            "ownerUserId": "owner1",
            "workspaceId": "ws1",
            "storageFileId": "sess1",
            "durationMs": 90_000,
            "format": "mp4",
        },
        "durationMs": 90_000,
        "answeredCount": 1,
    }


def test_functions_adapter_dispatches_async_execution():
    captured: dict[str, object] = {}

    class _FakeSdkFunctions:
        def create_execution(self, **kwargs):
            captured.update(kwargs)
            return {"$id": "exec-1"}

    _FunctionsAdapter(_FakeSdkFunctions()).create_execution(
        "finalizeInterviewSession", "{}"
    )

    assert captured["function_id"] == "finalizeInterviewSession"
    assert captured["body"] == "{}"
    assert captured["xasync"] is True
