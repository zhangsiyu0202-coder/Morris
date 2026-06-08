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

    repo.save_recording(
        "sess1",
        owner_user_id="owner1",
        file_bytes=b"video-bytes",
        duration_ms=5000,
        format="mp4",
    )

    assert len(storage.created) == 1
    assert storage.created[0][0] == RECORDINGS_BUCKET_ID
    assert storage.created[0][1] == "sess1"
    assert len(db.created) == 1
    assert db.created[0][1] == RECORDINGS_COLLECTION_ID
    assert db.created[0][2] == "sess1"
    assert db.created[0][3]["format"] == "mp4"


def test_repository_save_recording_updates_existing_document():
    db = _FakeDatabases()
    db.documents[("surveys", "sv1")] = {"ownerUserId": "owner1"}
    storage = _FakeStorage()
    repo = InterviewRepository(db, _SilentLogger(), storage=storage)

    repo.save_recording(
        "sess1",
        owner_user_id="owner1",
        file_bytes=b"first",
        duration_ms=1000,
        format="mp4",
    )

    def fail_create(*args, **kwargs):
        raise RuntimeError("conflict")

    db.create_document = fail_create  # type: ignore[method-assign]

    repo.save_recording(
        "sess1",
        owner_user_id="owner1",
        file_bytes=b"second",
        duration_ms=2000,
        format="mp4",
    )

    assert len(db.updated) >= 1
    assert db.updated[-1][1] == RECORDINGS_COLLECTION_ID
    assert db.updated[-1][3]["durationMs"] == 2000


def test_repository_resolve_owner_user_id():
    db = _FakeDatabases()
    db.documents[("surveys", "sv1")] = {"ownerUserId": "owner1"}
    repo = InterviewRepository(db, _SilentLogger())
    assert repo.resolve_owner_user_id("sv1") == "owner1"
    assert repo.resolve_owner_user_id("missing") is None
