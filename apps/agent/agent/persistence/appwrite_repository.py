"""Appwrite persistence for interview sessions and transcripts.

The repository depends only on a small ``DatabasesClient`` protocol so it can be
unit tested with a fake. ``from_env`` lazily builds the real Appwrite SDK client
(the ``appwrite`` package is a base dependency but the import stays lazy so the
module is importable in environments where it isn't installed).

Document shapes come from ``serializers`` and mirror the declared schema. All
writes are wrapped so a persistence failure degrades gracefully rather than
killing the live interview.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

from agent.contracts import SessionState, TranscriptSegment
from agent.persistence.serializers import (
    DATABASE_ID,
    SESSIONS_COLLECTION_ID,
    TRANSCRIPTS_COLLECTION_ID,
    session_completion_fields,
    session_failure_fields,
    session_progress_fields,
    transcript_document,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@runtime_checkable
class DatabasesClient(Protocol):
    """Subset of the Appwrite ``Databases`` service the repository needs."""

    def create_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any: ...

    def update_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any: ...


class InterviewRepository:
    """Persists session progress, completion, and transcripts to Appwrite."""

    def __init__(self, databases: DatabasesClient, logger: Any) -> None:
        self._db = databases
        self._log = logger

    @classmethod
    def from_env(cls, env: Mapping[str, str], logger: Any) -> "InterviewRepository":
        """Build a repository backed by the real Appwrite SDK (lazy import)."""
        from appwrite.client import Client
        from appwrite.services.databases import Databases

        endpoint = env.get("APPWRITE_ENDPOINT")
        project = env.get("APPWRITE_PROJECT_ID")
        api_key = env.get("APPWRITE_API_KEY")
        if not (endpoint and project and api_key):
            raise ValueError("APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY are required")

        client = Client()
        client.set_endpoint(endpoint).set_project(project).set_key(api_key)
        return cls(_DatabasesAdapter(Databases(client)), logger)

    def mark_in_progress(self, session_id: str) -> None:
        fields = session_progress_fields(state="in_progress", started_at=_now_iso())
        self._safe_update(session_id, fields, "mark session in_progress")

    def update_state(self, session_id: str, state: SessionState) -> None:
        self._safe_update(session_id, session_progress_fields(state=state), f"update session state {state}")

    def complete_session(self, session_id: str, collected_answers: Mapping[str, Any]) -> None:
        fields = session_completion_fields(
            collected_answers=dict(collected_answers),
            ended_at=_now_iso(),
        )
        self._safe_update(session_id, fields, "complete session")

    def fail_session(self, session_id: str, error_context: Mapping[str, Any]) -> None:
        fields = session_failure_fields(error_context=dict(error_context), ended_at=_now_iso())
        self._safe_update(session_id, fields, "fail session")

    def save_transcript(
        self, session_id: str, segments: Sequence[TranscriptSegment], language: str
    ) -> None:
        """Write (or rewrite) the finalized transcript document for the session.

        Uses the sessionId as the deterministic document id so a re-finalization
        upserts rather than duplicating.
        """
        document = transcript_document(
            session_id=session_id,
            segments=segments,
            language=language,
            finalized_at=_now_iso(),
        )
        try:
            self._db.create_document(DATABASE_ID, TRANSCRIPTS_COLLECTION_ID, session_id, document)
        except Exception as create_error:  # noqa: BLE001 - upsert fallback
            try:
                self._db.update_document(DATABASE_ID, TRANSCRIPTS_COLLECTION_ID, session_id, document)
            except Exception as update_error:  # noqa: BLE001
                self._log.error(
                    "failed to persist transcript",
                    sessionId=session_id,
                    createError=str(create_error),
                    updateError=str(update_error),
                )

    def _safe_update(self, session_id: str, fields: Mapping[str, Any], action: str) -> None:
        try:
            self._db.update_document(DATABASE_ID, SESSIONS_COLLECTION_ID, session_id, fields)
        except Exception as error:  # noqa: BLE001 - never let persistence kill the call
            self._log.error("persistence failed", action=action, sessionId=session_id, error=str(error))


class _DatabasesAdapter:
    """Adapts the Appwrite ``Databases`` service to ``DatabasesClient``.

    The SDK uses keyword args (``database_id=...``); this keeps the protocol
    positional and stable for tests.
    """

    def __init__(self, databases: Any) -> None:
        self._databases = databases

    def create_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any:
        return self._databases.create_document(
            database_id=database_id,
            collection_id=collection_id,
            document_id=document_id,
            data=dict(data),
        )

    def update_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any:
        return self._databases.update_document(
            database_id=database_id,
            collection_id=collection_id,
            document_id=document_id,
            data=dict(data),
        )
