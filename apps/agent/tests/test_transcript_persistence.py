"""Unit tests for the transcript collector, serializers, and repository."""
from __future__ import annotations

import json

from agent.contracts import TranscriptSegment
from agent.interview.transcript import (
    SPEAKER_AGENT,
    SPEAKER_INTERVIEWEE,
    TranscriptCollector,
)
from agent.persistence.appwrite_repository import InterviewRepository
from agent.persistence.serializers import (
    SESSIONS_COLLECTION_ID,
    TRANSCRIPTS_COLLECTION_ID,
    session_completion_fields,
    session_failure_fields,
    session_progress_fields,
    transcript_document,
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

    def create_document(self, database_id, collection_id, document_id, data):
        if self._fail_create:
            raise RuntimeError("create not allowed")
        self.created.append((database_id, collection_id, document_id, dict(data)))
        return {"$id": document_id}

    def update_document(self, database_id, collection_id, document_id, data):
        self.updated.append((database_id, collection_id, document_id, dict(data)))
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


def test_transcript_document_serializes_segments_as_json_string():
    seg = TranscriptSegment(speaker="agent", startMs=0, endMs=10, text="hi")
    doc = transcript_document(session_id="s1", segments=[seg], language="zh", finalized_at="2026-01-01T00:00:00Z")
    assert doc["sessionId"] == "s1"
    decoded = json.loads(doc["segments"])
    assert decoded[0]["text"] == "hi"


def test_session_field_builders():
    progress = session_progress_fields(state="in_progress", started_at="t")
    assert progress == {"state": "in_progress", "startedAt": "t"}

    completion = session_completion_fields(collected_answers={"q1": {"answer": "a"}}, ended_at="t")
    assert completion["state"] == "completed"
    assert json.loads(completion["collectedAnswers"])["q1"]["answer"] == "a"

    failure = session_failure_fields(error_context={"message": "boom"}, ended_at="t")
    assert failure["state"] == "failed"
    assert json.loads(failure["errorContext"])["message"] == "boom"


# -- repository ---------------------------------------------------------------


def test_repository_writes_session_lifecycle():
    db = _FakeDatabases()
    repo = InterviewRepository(db, _SilentLogger())

    repo.mark_in_progress("s1")
    repo.complete_session("s1", {"q1": {"answer": "a"}})

    assert len(db.updated) == 2
    assert db.updated[0][1] == SESSIONS_COLLECTION_ID
    assert db.updated[0][3]["state"] == "in_progress"
    assert db.updated[1][3]["state"] == "completed"


def test_repository_save_transcript_creates_document():
    db = _FakeDatabases()
    repo = InterviewRepository(db, _SilentLogger())
    seg = TranscriptSegment(speaker="agent", startMs=0, endMs=5, text="hi")

    repo.save_transcript("s1", [seg], "zh")

    assert len(db.created) == 1
    assert db.created[0][1] == TRANSCRIPTS_COLLECTION_ID
    assert db.created[0][2] == "s1"


def test_repository_save_transcript_falls_back_to_update_on_conflict():
    db = _FakeDatabases(fail_create=True)
    repo = InterviewRepository(db, _SilentLogger())
    seg = TranscriptSegment(speaker="agent", startMs=0, endMs=5, text="hi")

    repo.save_transcript("s1", [seg], "zh")

    assert db.created == []
    assert len(db.updated) == 1
    assert db.updated[0][1] == TRANSCRIPTS_COLLECTION_ID


def test_repository_swallows_persistence_errors():
    class _AlwaysFails:
        def create_document(self, *a, **k):
            raise RuntimeError("down")

        def update_document(self, *a, **k):
            raise RuntimeError("down")

    repo = InterviewRepository(_AlwaysFails(), _SilentLogger())
    # Should not raise -- persistence failures must not kill the live interview.
    repo.mark_in_progress("s1")
    repo.save_transcript("s1", [TranscriptSegment(speaker="agent", startMs=0, endMs=1, text="x")], "zh")
