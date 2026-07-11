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
from typing import Any, Protocol, runtime_checkable

from agent.contracts import (
    RecordingFormat,
    SessionState,
    TranscriptSegment,
    now_iso,
)
from agent.persistence.serializers import (
    DATABASE_ID,
    RECORDINGS_BUCKET_ID,
    SESSIONS_COLLECTION_ID,
    SURVEYS_COLLECTION_ID,
    session_failure_fields,
    session_progress_fields,
)


def _tenant_read_permissions(
    owner_user_id: str | None, workspace_id: str | None
) -> list[str] | None:
    """ADR-0006 (B): owner reads, and the workspace team reads when the artifact
    belongs to a workspace. Returns None when no owner is known (keeps the prior
    no-explicit-permissions behavior for un-tenanted writes)."""
    if not owner_user_id:
        return None
    perms = [f'read("user:{owner_user_id}")']
    if workspace_id:
        perms.append(f'read("team:{workspace_id}")')
    return perms


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
    """Persists in-progress session state and recording uploads to Appwrite.

    Finalized transcript/session/usage persistence is dispatched to the
    finalizeInterviewSession Function.
    """

    # Function ids may be overridden via env (defaults match apps/functions
    # directory names, which we deploy 1:1 to Appwrite).
    DEFAULT_FINALIZE_SESSION_FN = "finalizeInterviewSession"

    def __init__(
        self,
        databases: DatabasesClient,
        logger: Any,
        functions: FunctionsClient | None = None,
        storage: StorageClient | None = None,
        *,
        finalize_session_fn: str = DEFAULT_FINALIZE_SESSION_FN,
    ) -> None:
        self._db = databases
        self._log = logger
        self._functions = functions
        self._storage = storage
        self._finalize_session_fn = finalize_session_fn

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
            finalize_session_fn=env.get("FINALIZE_INTERVIEW_SESSION_FUNCTION_ID", cls.DEFAULT_FINALIZE_SESSION_FN),
        )

    def finalize_session(
        self,
        session_id: str,
        survey_id: str,
        *,
        collected_answers: Mapping[str, Any],
        state: SessionState,
        transcript_segments: Sequence[TranscriptSegment],
        recording: Mapping[str, Any] | None = None,
        duration_ms: int,
        answered_count: int,
        language: str = "zh",
    ) -> None:
        if self._functions is None:
            self._log.warn(
                "session finalization skipped: no Functions client configured",
                sessionId=session_id,
            )
            return
        try:
            self._functions.create_execution(
                self._finalize_session_fn,
                _json_body(
                    {
                        "sessionId": session_id,
                        "surveyId": survey_id,
                        "state": state,
                        "collectedAnswers": dict(collected_answers),
                        "transcript": {
                            "segments": [segment.model_dump() for segment in transcript_segments],
                            "language": language,
                        },
                        **({"recording": dict(recording)} if recording is not None else {}),
                        "durationMs": duration_ms,
                        "answeredCount": answered_count,
                    }
                ),
            )
        except Exception as error:  # noqa: BLE001
            self._log.error(
                "finalizeInterviewSession dispatch failed",
                sessionId=session_id,
                surveyId=survey_id,
                error=str(error),
            )

    def mark_in_progress(self, session_id: str) -> None:
        fields = session_progress_fields(state="in_progress", started_at=now_iso())
        self._safe_update(session_id, fields, "mark session in_progress")

    def update_state(self, session_id: str, state: SessionState) -> None:
        self._safe_update(session_id, session_progress_fields(state=state), f"update session state {state}")

    def fail_session(self, session_id: str, error_context: Mapping[str, Any]) -> None:
        fields = session_failure_fields(error_context=dict(error_context), ended_at=now_iso())
        self._safe_update(session_id, fields, "fail session")

    def _upsert_document(
        self,
        collection_id: str,
        doc_id: str,
        document: Mapping[str, Any],
        permissions: Sequence[str] | None,
        label: str,
    ) -> None:
        try:
            self._db.create_document(
                DATABASE_ID, collection_id, doc_id, document, permissions
            )
        except Exception as create_error:  # noqa: BLE001 - upsert fallback
            try:
                self._db.update_document(
                    DATABASE_ID, collection_id, doc_id, document
                )
            except Exception as update_error:  # noqa: BLE001
                self._log.error(
                    f"failed to persist {label}",
                    sessionId=doc_id,
                    createError=str(create_error),
                    updateError=str(update_error),
                )

    def resolve_survey_tenancy(self, survey_id: str) -> tuple[str | None, str | None]:
        """Read ``(ownerUserId, workspaceId)`` from the survey for document
        permissions on agent-written artifacts (ADR-0006 B: owner + workspace
        team read)."""
        try:
            survey = self._db.get_document(DATABASE_ID, SURVEYS_COLLECTION_ID, survey_id)

            def _field(name: str) -> str | None:
                val = getattr(survey, name, None)
                if val is None and isinstance(survey, Mapping):
                    val = survey.get(name)
                return val if isinstance(val, str) and val else None

            return _field("ownerUserId"), _field("workspaceId")
        except Exception as error:  # noqa: BLE001
            self._log.warn(
                "failed to resolve survey tenancy for artifact permissions",
                surveyId=survey_id,
                error=str(error),
            )
            return None, None

    def save_recording(
        self,
        session_id: str,
        *,
        owner_user_id: str,
        workspace_id: str | None = None,
        file_bytes: bytes,
        duration_ms: int,
        format: RecordingFormat,
    ) -> dict[str, Any] | None:
        """Upload the interview video to Storage and return recording metadata.

        The metadata row itself is finalized through finalizeInterviewSession;
        this method owns only the binary upload path.
        """
        if self._storage is None:
            self._log.warn("recording persistence skipped: no Storage client configured", sessionId=session_id)
            return None

        uploaded = self._upload_recording_file(
            session_id=session_id,
            file_bytes=file_bytes,
            format=format,
            owner_user_id=owner_user_id,
            workspace_id=workspace_id,
        )
        if not uploaded:
            return None
        return {
            "ownerUserId": owner_user_id,
            "workspaceId": workspace_id,
            "storageFileId": session_id,
            "durationMs": duration_ms,
            "format": format,
        }

    def _upload_recording_file(
        self,
        *,
        session_id: str,
        file_bytes: bytes,
        format: RecordingFormat,
        owner_user_id: str,
        workspace_id: str | None,
    ) -> bool:
        """Upload the recording to Appwrite Storage. Returns True on success."""
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
            if workspace_id:
                permissions.append(Permission.read(Role.team(workspace_id)))
            upload = InputFile.from_bytes(file_bytes, filename=filename, mime_type=mime_type)
            try:
                self._storage.create_file(
                    RECORDINGS_BUCKET_ID,
                    session_id,
                    upload,
                    permissions,
                )
            except Exception as create_error:  # noqa: BLE001 - upsert fallback
                try:
                    self._storage.delete_file(RECORDINGS_BUCKET_ID, session_id)
                except Exception:  # noqa: BLE001 - best-effort replace
                    pass
                self._storage.create_file(
                    RECORDINGS_BUCKET_ID,
                    session_id,
                    upload,
                    permissions,
                )
                self._log.warn(
                    "replaced existing recording file",
                    sessionId=session_id,
                    createError=str(create_error),
                )
            return True
        except Exception as error:  # noqa: BLE001
            self._log.error(
                "failed to upload recording to storage",
                sessionId=session_id,
                error=str(error),
            )
            return False

    def _safe_update(self, session_id: str, fields: Mapping[str, Any], action: str) -> None:
        try:
            self._db.update_document(DATABASE_ID, SESSIONS_COLLECTION_ID, session_id, fields)
        except Exception as error:  # noqa: BLE001 - never let persistence kill the call
            if _is_sdk_skew_error(error):
                # Self-hosted Appwrite Server 1.6.0 (the latest stable that
                # talks to MariaDB) returns documents without ``$sequence``
                # and files without ``sizeActual / encryption / compression``;
                # the Python SDK 20.x is already built for the (unreleased)
                # 1.9.5 response shape and rejects the body via pydantic.
                # The wire write itself succeeded; we surface a warn rather
                # than masking the operation entirely.
                self._log.warn(
                    "persistence sdk-response-validation skew (state still updated)",
                    action=action,
                    sessionId=session_id,
                    note="server v1.6.0 lacks $sequence in update response; SDK 20.x requires it",
                )
                return
            self._log.error("persistence failed", action=action, sessionId=session_id, error=str(error))


import json as _stdlib_json


def _json_body(payload: Mapping[str, Any]) -> str:
    return _stdlib_json.dumps(payload)


def _is_sdk_skew_error(error: BaseException) -> bool:
    """True when the Appwrite Python SDK rejected a successful HTTP
    response because the server (1.6.0 stable) returns a payload that
    omits fields the SDK 20.x pydantic models expect (``$sequence`` on
    Document; ``sizeActual / encryption / compression`` on File).

    The SDK either raises ``pydantic.ValidationError`` directly or wraps
    it in an ``AppwriteException`` whose message starts with
    ``"Unable to parse response into <Model>"``. Both forms indicate
    the wire write succeeded; only the response *parsing* failed.

    Genuine errors (404, 5xx, network) never match either form and
    re-raise from the call site. This helper exists because Appwrite
    ships SDK 20.x against a server release (1.9.5) that has not been
    cut yet, and 1.6.0 is the latest stable on Docker Hub that runs on
    MariaDB. Once Appwrite 1.9.x ships and we upgrade, every call site
    using this helper can drop back to the plain SDK call.
    """
    try:
        from pydantic import ValidationError  # local: keep import surface tight
    except ImportError:
        ValidationError = None  # type: ignore[assignment]
    if ValidationError is not None and isinstance(error, ValidationError):
        return True
    return "Unable to parse response into" in str(error)


class _FunctionsAdapter:
    """Adapts the Appwrite ``Functions`` service to ``FunctionsClient``."""

    def __init__(self, functions: Any) -> None:
        self._functions = functions

    def create_execution(self, function_id: str, body: str) -> Any:
        # SDK 20.x signature uses ``xasync`` (not ``x_async``); using the
        # wrong name silently runs sync (default behaviour) but newer
        # SDKs raise. Pin to the documented current name.
        try:
            return self._functions.create_execution(
                function_id=function_id,
                body=body,
                xasync=True,
                method="POST",
                headers={"content-type": "application/json"},
            )
        except Exception as error:  # noqa: BLE001 - inspect for SDK skew
            # Same SDK 20.x vs Appwrite server 1.6.0 skew applied at the
            # database adapter sites: the execution actually ran on the
            # server (we can confirm via the executions list endpoint),
            # but the SDK's pydantic Execution model rejected the response
            # because ``deploymentId`` is absent on Appwrite 1.6 (it ships
            # in 1.9+). Synthesize a minimal stub so callers can continue.
            # Genuine errors (404, 5xx, network) re-raise.
            if _is_sdk_skew_error(error):
                return {"$id": "", "functionId": function_id, "status": "completed"}
            raise


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
        try:
            return self._databases.create_document(**kwargs)
        except Exception as error:  # noqa: BLE001 - inspect for SDK skew
            if _is_sdk_skew_error(error):
                return {"$id": document_id, **dict(data)}
            raise

    def update_document(
        self, database_id: str, collection_id: str, document_id: str, data: Mapping[str, Any]
    ) -> Any:
        try:
            return self._databases.update_document(
                database_id=database_id,
                collection_id=collection_id,
                document_id=document_id,
                data=dict(data),
            )
        except Exception as error:  # noqa: BLE001 - inspect for SDK skew
            if _is_sdk_skew_error(error):
                return {"$id": document_id, **dict(data)}
            raise

    def get_document(self, database_id: str, collection_id: str, document_id: str) -> Mapping[str, Any]:
        try:
            return self._databases.get_document(
                database_id=database_id,
                collection_id=collection_id,
                document_id=document_id,
            )
        except Exception as error:  # noqa: BLE001 - inspect for SDK skew
            if _is_sdk_skew_error(error):
                client = getattr(self._databases, "client", None)
                if client is None:
                    raise
                api_path = (
                    f"/databases/{database_id}/collections/{collection_id}/documents/{document_id}"
                )
                return client.call(
                    "get",
                    api_path,
                    {"X-Appwrite-Project": client.get_config("project")},
                )
            raise


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
        try:
            return self._storage.create_file(**kwargs)
        except Exception as error:  # noqa: BLE001 - inspect for SDK skew
            if _is_sdk_skew_error(error):
                # Upload succeeded server-side; only the response model
                # rejected the body. Re-fetch metadata via raw HTTP if
                # we can; otherwise return a minimal stub so callers can
                # still wire up the recording document with the file id.
                client = getattr(self._storage, "client", None)
                if client is not None:
                    api_path = f"/storage/buckets/{bucket_id}/files/{file_id}"
                    try:
                        return client.call(
                            "get",
                            api_path,
                            {"X-Appwrite-Project": client.get_config("project")},
                        )
                    except Exception:  # noqa: BLE001 - synthesise as last resort
                        pass
                return {"$id": file_id, "bucketId": bucket_id}
            raise

    def delete_file(self, bucket_id: str, file_id: str) -> Any:
        return self._storage.delete_file(bucket_id=bucket_id, file_id=file_id)
