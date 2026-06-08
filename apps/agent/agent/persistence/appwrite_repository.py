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

from agent.contracts import RecordingFormat, SessionState, TranscriptSegment
from agent.persistence.serializers import (
    DATABASE_ID,
    RECORDINGS_BUCKET_ID,
    RECORDINGS_COLLECTION_ID,
    SESSIONS_COLLECTION_ID,
    SURVEYS_COLLECTION_ID,
    TRANSCRIPTS_COLLECTION_ID,
    recording_document,
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
        self,
        database_id: str,
        collection_id: str,
        document_id: str,
        data: Mapping[str, Any],
        permissions: Sequence[str] | None = None,
    ) -> Any: ...

    def update_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any: ...

    def get_document(self, database_id: str, collection_id: str, document_id: str) -> Any: ...


@runtime_checkable
class StorageClient(Protocol):
    """Subset of the Appwrite ``Storage`` service the repository needs."""

    def create_file(
        self,
        bucket_id: str,
        file_id: str,
        file: Any,
        permissions: Sequence[str] | None = None,
    ) -> Any: ...

    def delete_file(self, bucket_id: str, file_id: str) -> Any: ...


@runtime_checkable
class FunctionsClient(Protocol):
    """Subset of the Appwrite ``Functions`` service the repository needs."""

    def create_execution(self, function_id: str, body: str) -> Any: ...


class InterviewRepository:
    """Persists session progress, completion, and transcripts to Appwrite."""

    # Function ids may be overridden via env (defaults match apps/functions
    # directory names, which we deploy 1:1 to Appwrite).
    DEFAULT_ANALYZE_SESSION_FN = "analyzeSession"
    DEFAULT_ANALYZE_SURVEY_FN = "analyzeSurvey"

    def __init__(
        self,
        databases: DatabasesClient,
        logger: Any,
        functions: FunctionsClient | None = None,
        storage: StorageClient | None = None,
        *,
        analyze_session_fn: str = DEFAULT_ANALYZE_SESSION_FN,
        analyze_survey_fn: str = DEFAULT_ANALYZE_SURVEY_FN,
    ) -> None:
        self._db = databases
        self._log = logger
        self._functions = functions
        self._storage = storage
        self._analyze_session_fn = analyze_session_fn
        self._analyze_survey_fn = analyze_survey_fn

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

        from appwrite.services.functions import Functions
        from appwrite.services.storage import Storage

        client = Client()
        client.set_endpoint(endpoint).set_project(project).set_key(api_key)
        return cls(
            _DatabasesAdapter(Databases(client)),
            logger,
            _FunctionsAdapter(Functions(client)),
            _StorageAdapter(Storage(client)),
            analyze_session_fn=env.get("ANALYZE_SESSION_FUNCTION_ID", cls.DEFAULT_ANALYZE_SESSION_FN),
            analyze_survey_fn=env.get("ANALYZE_SURVEY_FUNCTION_ID", cls.DEFAULT_ANALYZE_SURVEY_FN),
        )

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

    def resolve_owner_user_id(self, survey_id: str) -> str | None:
        """Read ``ownerUserId`` from the survey document for recording permissions."""
        try:
            survey = self._db.get_document(DATABASE_ID, SURVEYS_COLLECTION_ID, survey_id)
            owner = getattr(survey, "ownerUserId", None) or (
                survey.get("ownerUserId") if isinstance(survey, Mapping) else None
            )
            return owner if isinstance(owner, str) and owner else None
        except Exception as error:  # noqa: BLE001
            self._log.warn(
                "failed to resolve survey owner for recording",
                surveyId=survey_id,
                error=str(error),
            )
            return None

    def save_recording(
        self,
        session_id: str,
        *,
        owner_user_id: str,
        file_bytes: bytes,
        duration_ms: int,
        format: RecordingFormat,
    ) -> None:
        """Upload the interview video to Storage and upsert the recordings document."""
        if self._storage is None:
            self._log.warn("recording persistence skipped: no Storage client configured", sessionId=session_id)
            return

        storage_file_id = session_id
        mime_by_format: dict[RecordingFormat, str] = {
            "mp4": "video/mp4",
            "webm": "video/webm",
            "mp3": "audio/mpeg",
            "opus": "audio/ogg",
            "wav": "audio/wav",
        }
        mime_type = mime_by_format.get(format, "application/octet-stream")
        filename = f"interview-{session_id}.{format}"

        try:
            from appwrite.input_file import InputFile
            from appwrite.permission import Permission
            from appwrite.role import Role

            permissions = [Permission.read(Role.user(owner_user_id))]
            upload = InputFile.from_bytes(file_bytes, filename=filename, mime_type=mime_type)
            try:
                self._storage.create_file(
                    RECORDINGS_BUCKET_ID,
                    storage_file_id,
                    upload,
                    permissions,
                )
            except Exception as create_error:  # noqa: BLE001 - upsert fallback
                try:
                    self._storage.delete_file(RECORDINGS_BUCKET_ID, storage_file_id)
                except Exception:  # noqa: BLE001 - best-effort replace
                    pass
                self._storage.create_file(
                    RECORDINGS_BUCKET_ID,
                    storage_file_id,
                    upload,
                    permissions,
                )
                self._log.warn(
                    "replaced existing recording file",
                    sessionId=session_id,
                    createError=str(create_error),
                )
        except Exception as error:  # noqa: BLE001
            self._log.error(
                "failed to upload recording to storage",
                sessionId=session_id,
                error=str(error),
            )
            return

        document = recording_document(
            session_id=session_id,
            owner_user_id=owner_user_id,
            storage_file_id=storage_file_id,
            duration_ms=duration_ms,
            format=format,
        )
        permissions = [f'read("user:{owner_user_id}")']
        try:
            self._db.create_document(
                DATABASE_ID,
                RECORDINGS_COLLECTION_ID,
                session_id,
                document,
                permissions,
            )
        except Exception as create_error:  # noqa: BLE001 - upsert fallback
            try:
                self._db.update_document(DATABASE_ID, RECORDINGS_COLLECTION_ID, session_id, document)
            except Exception as update_error:  # noqa: BLE001
                self._log.error(
                    "failed to persist recording document",
                    sessionId=session_id,
                    createError=str(create_error),
                    updateError=str(update_error),
                )

    def trigger_post_session_analysis(self, session_id: str, survey_id: str) -> None:
        """Fire-and-await the analyze Functions after a session completes.

        Per ADR-0003 D1+D4 the agent worker chains:
            session.state=completed  ->  analyzeSession(sessionId)
                                     ->  analyzeSurvey(surveyId)

        Failures are logged but never raised: a session is durably completed
        before this method is called, so the worst case is a missing report
        the researcher can regenerate manually from /reports/[surveyId].
        """
        if self._functions is None:
            self._log.warn(
                "post-session analysis skipped: no Functions client configured",
                sessionId=session_id,
            )
            return
        try:
            self._functions.create_execution(
                self._analyze_session_fn, _json_body({"sessionId": session_id})
            )
        except Exception as error:  # noqa: BLE001
            self._log.error(
                "analyzeSession dispatch failed",
                sessionId=session_id,
                error=str(error),
            )
            return  # Skip survey rollup if session-level analysis didn't dispatch.
        try:
            self._functions.create_execution(
                self._analyze_survey_fn, _json_body({"surveyId": survey_id})
            )
        except Exception as error:  # noqa: BLE001
            self._log.error(
                "analyzeSurvey dispatch failed",
                surveyId=survey_id,
                error=str(error),
            )

    def _safe_update(self, session_id: str, fields: Mapping[str, Any], action: str) -> None:
        try:
            self._db.update_document(DATABASE_ID, SESSIONS_COLLECTION_ID, session_id, fields)
        except Exception as error:  # noqa: BLE001 - never let persistence kill the call
            self._log.error("persistence failed", action=action, sessionId=session_id, error=str(error))


import json as _stdlib_json


def _json_body(payload: Mapping[str, Any]) -> str:
    return _stdlib_json.dumps(payload)


class _FunctionsAdapter:
    """Adapts the Appwrite ``Functions`` service to ``FunctionsClient``."""

    def __init__(self, functions: Any) -> None:
        self._functions = functions

    def create_execution(self, function_id: str, body: str) -> Any:
        return self._functions.create_execution(
            function_id=function_id,
            body=body,
            x_async=False,
            method="POST",
            headers={"content-type": "application/json"},
        )


class _DatabasesAdapter:
    """Adapts the Appwrite ``Databases`` service to ``DatabasesClient``.

    The SDK uses keyword args (``database_id=...``); this keeps the protocol
    positional and stable for tests.
    """

    def __init__(self, databases: Any) -> None:
        self._databases = databases

    def create_document(
        self,
        database_id: str,
        collection_id: str,
        document_id: str,
        data: Mapping[str, Any],
        permissions: Sequence[str] | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {
            "database_id": database_id,
            "collection_id": collection_id,
            "document_id": document_id,
            "data": dict(data),
        }
        if permissions is not None:
            kwargs["permissions"] = list(permissions)
        return self._databases.create_document(**kwargs)

    def update_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any:
        return self._databases.update_document(
            database_id=database_id,
            collection_id=collection_id,
            document_id=document_id,
            data=dict(data),
        )

    def get_document(self, database_id: str, collection_id: str, document_id: str) -> Mapping[str, Any]:
        return self._databases.get_document(
            database_id=database_id,
            collection_id=collection_id,
            document_id=document_id,
        )


class _StorageAdapter:
    """Adapts the Appwrite ``Storage`` service to ``StorageClient``."""

    def __init__(self, storage: Any) -> None:
        self._storage = storage

    def create_file(
        self,
        bucket_id: str,
        file_id: str,
        file: Any,
        permissions: Sequence[str] | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {
            "bucket_id": bucket_id,
            "file_id": file_id,
            "file": file,
        }
        if permissions is not None:
            kwargs["permissions"] = list(permissions)
        return self._storage.create_file(**kwargs)

    def delete_file(self, bucket_id: str, file_id: str) -> Any:
        return self._storage.delete_file(bucket_id=bucket_id, file_id=file_id)
