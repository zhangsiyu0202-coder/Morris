"""Unit tests for the billable UsageEvent emit (ADR-0006 D6)."""
from __future__ import annotations

from agent.contracts import is_billable_interview, usage_event_id
from agent.persistence.appwrite_repository import InterviewRepository
from agent.persistence.serializers import USAGE_EVENTS_COLLECTION_ID


class _SilentLogger:
    def info(self, *a, **k): ...
    def warn(self, *a, **k): ...
    def error(self, *a, **k): ...


class _FakeDatabases:
    """create_document raises (like Appwrite 409) when the id already exists,
    so idempotency is exercised naturally."""

    def __init__(self) -> None:
        self.created: list[tuple] = []
        self.documents: dict[tuple[str, str], dict] = {}

    def create_document(self, database_id, collection_id, document_id, data, permissions=None):
        key = (collection_id, document_id)
        if key in self.documents:
            raise RuntimeError("document_already_exists")  # 409
        self.created.append((database_id, collection_id, document_id, dict(data)))
        self.documents[key] = dict(data)
        return {"$id": document_id}

    def update_document(self, database_id, collection_id, document_id, data, permissions=None):
        self.documents[(collection_id, document_id)] = dict(data)
        return {"$id": document_id}

    def get_document(self, database_id, collection_id, document_id):
        doc = self.documents.get((collection_id, document_id))
        if doc is None:
            raise RuntimeError("not found")
        return doc


def _repo_with_survey(**survey_fields) -> tuple[InterviewRepository, _FakeDatabases]:
    db = _FakeDatabases()
    db.documents[("surveys", "sv1")] = dict(survey_fields)
    return InterviewRepository(db, _SilentLogger()), db


def test_is_billable_interview_thresholds():
    assert is_billable_interview(state="completed", duration_ms=60_000, answered_count=1) is True
    assert is_billable_interview(state="completed", duration_ms=59_999, answered_count=1) is False
    assert is_billable_interview(state="completed", duration_ms=60_000, answered_count=0) is False
    assert is_billable_interview(state="collecting", duration_ms=99_000, answered_count=3) is False


def test_emit_writes_one_usage_event_when_billable_and_workspaced():
    repo, db = _repo_with_survey(ownerUserId="owner1", workspaceId="ws1")
    repo.emit_usage_event("sess1", "sv1", duration_ms=90_000, answered_count=2)

    events = [c for c in db.created if c[1] == USAGE_EVENTS_COLLECTION_ID]
    assert len(events) == 1
    _db, _coll, doc_id, data = events[0]
    assert doc_id == usage_event_id("sess1") == "ue_sess1"
    assert data["workspaceId"] == "ws1"
    assert data["studyId"] == "sv1"
    assert data["sessionId"] == "sess1"
    assert data["unit"] == "completed_interview"


def test_emit_is_idempotent_per_session():
    repo, db = _repo_with_survey(ownerUserId="owner1", workspaceId="ws1")
    repo.emit_usage_event("sess1", "sv1", duration_ms=90_000, answered_count=2)
    # A retry / re-finalize collides on ue_sess1 (409) and is swallowed.
    repo.emit_usage_event("sess1", "sv1", duration_ms=90_000, answered_count=2)
    events = [c for c in db.created if c[1] == USAGE_EVENTS_COLLECTION_ID]
    assert len(events) == 1  # billed at most once


def test_emit_skips_solo_session_without_workspace():
    repo, db = _repo_with_survey(ownerUserId="owner1")  # no workspaceId
    repo.emit_usage_event("sess1", "sv1", duration_ms=90_000, answered_count=2)
    assert [c for c in db.created if c[1] == USAGE_EVENTS_COLLECTION_ID] == []


def test_emit_skips_when_below_thresholds():
    repo, db = _repo_with_survey(ownerUserId="owner1", workspaceId="ws1")
    repo.emit_usage_event("short", "sv1", duration_ms=10_000, answered_count=5)
    repo.emit_usage_event("empty", "sv1", duration_ms=90_000, answered_count=0)
    assert [c for c in db.created if c[1] == USAGE_EVENTS_COLLECTION_ID] == []
