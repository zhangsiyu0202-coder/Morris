"""Unit tests for recording serializers and repository persistence."""
from __future__ import annotations

from agent.persistence.appwrite_repository import InterviewRepository
from agent.persistence.serializers import (
    RECORDINGS_BUCKET_ID,
    RECORDINGS_COLLECTION_ID,
    recording_document,
)


class _SilentLogger:
    def info(self, *a, **k): ...
    def warn(self, *a, **k): ...
    def error(self, *a, **k): ...


class _FakeDatabases:
    def __init__(self) -> None:
        self.created: list[tuple] = []
        self.updated: list[tuple] = []
        self.documents: dict[tuple[str, str], dict] = {}

    def create_document(self, database_id, collection_id, document_id, data, permissions=None):
        self.created.append((database_id, collection_id, document_id, dict(data), permissions))
        self.documents[(collection_id, document_id)] = dict(data)
        return {"$id": document_id}

    def update_document(self, database_id, collection_id, document_id, data):
        self.updated.append((database_id, collection_id, document_id, dict(data)))
        self.documents[(collection_id, document_id)] = dict(data)
        return {"$id": document_id}

    def get_document(self, database_id, collection_id, document_id):
        doc = self.documents.get((collection_id, document_id))
        if doc is None:
            raise RuntimeError("not found")
        return doc


class _FakeStorage:
    def __init__(self) -> None:
        self.created: list[tuple] = []
        self.deleted: list[tuple] = []

    def create_file(self, bucket_id, file_id, file, permissions=None):
        self.created.append((bucket_id, file_id, permissions))
        return {"$id": file_id}

    def delete_file(self, bucket_id, file_id):
        self.deleted.append((bucket_id, file_id))


def test_recording_document_shape():
    doc = recording_document(
        session_id="sess1",
        owner_user_id="owner1",
        storage_file_id="sess1",
        duration_ms=12345,
        format="mp4",
    )
    assert doc == {
        "sessionId": "sess1",
        "ownerUserId": "owner1",
        "storageFileId": "sess1",
        "durationMs": 12345,
        "format": "mp4",
    }


def test_repository_save_recording_uploads_and_creates_document():
    db = _FakeDatabases()
    db.documents[("surveys", "sv1")] = {"ownerUserId": "owner1"}
    storage = _FakeStorage()
    repo = InterviewRepository(db, _SilentLogger(), storage=storage)

    metadata = repo.save_recording(
        "sess1",
        owner_user_id="owner1",
        file_bytes=b"video-bytes",
        duration_ms=5000,
        format="mp4",
    )

    assert len(storage.created) == 1
    assert storage.created[0][0] == RECORDINGS_BUCKET_ID
    assert storage.created[0][1] == "sess1"
    assert metadata == {
        "ownerUserId": "owner1",
        "workspaceId": None,
        "storageFileId": "sess1",
        "durationMs": 5000,
        "format": "mp4",
    }


def test_repository_resolve_survey_tenancy():
    db = _FakeDatabases()
    db.documents[("surveys", "sv1")] = {"ownerUserId": "owner1", "workspaceId": "ws1"}
    db.documents[("surveys", "solo")] = {"ownerUserId": "owner2"}
    repo = InterviewRepository(db, _SilentLogger())
    assert repo.resolve_survey_tenancy("sv1") == ("owner1", "ws1")
    assert repo.resolve_survey_tenancy("solo") == ("owner2", None)
    assert repo.resolve_survey_tenancy("missing") == (None, None)


def test_repository_save_recording_grants_team_read_when_workspaced():
    db = _FakeDatabases()
    storage = _FakeStorage()
    repo = InterviewRepository(db, _SilentLogger(), storage=storage)
    metadata = repo.save_recording(
        "s1",
        owner_user_id="owner1",
        workspace_id="ws1",
        file_bytes=b"x",
        duration_ms=10,
        format="mp4",
    )
    storage_perms = storage.created[-1][2]
    assert 'read("user:owner1")' in storage_perms
    assert 'read("team:ws1")' in storage_perms
    assert metadata == {
        "ownerUserId": "owner1",
        "workspaceId": "ws1",
        "storageFileId": "s1",
        "durationMs": 10,
        "format": "mp4",
    }
