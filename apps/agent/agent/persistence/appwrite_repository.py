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

from agent.contracts import (
    RecordingFormat,
    SessionState,
    TranscriptSegment,
    is_billable_interview,
    usage_event_id,
)
from agent.persistence.serializers import (
    DATABASE_ID,
    RECORDINGS_BUCKET_ID,
    RECORDINGS_COLLECTION_ID,
    SESSIONS_COLLECTION_ID,
    SURVEYS_COLLECTION_ID,
    TRANSCRIPTS_COLLECTION_ID,
    USAGE_EVENTS_COLLECTION_ID,
    recording_document,
    session_completion_fields,
    session_failure_fields,
    session_progress_fields,
    transcript_document,
    usage_event_document,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


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

    def complete_session(
        self,
        session_id: str,
        collected_answers: Mapping[str, Any],
        *,
        state: SessionState = "completed",
    ) -> None:
        fields = session_completion_fields(
            collected_answers=dict(collected_answers),
            ended_at=_now_iso(),
            state=state,
        )
        self._safe_update(session_id, fields, f"set session {state}")

    def fail_session(self, session_id: str, error_context: Mapping[str, Any]) -> None:
        fields = session_failure_fields(error_context=dict(error_context), ended_at=_now_iso())
        self._safe_update(session_id, fields, "fail session")

    def save_transcript(
        self,
        session_id: str,
        segments: Sequence[TranscriptSegment],
        language: str,
        *,
        owner_user_id: str | None = None,
        workspace_id: str | None = None,
    ) -> None:
        """Write (or rewrite) the finalized transcript document for the session.

        Uses the sessionId as the deterministic document id so a re-finalization
        upserts rather than duplicating. When the session's tenancy is known the
        document is readable by its owner + workspace team (ADR-0006 B).
        """
        document = transcript_document(
            session_id=session_id,
            segments=segments,
            language=language,
            finalized_at=_now_iso(),
        )
        permissions = _tenant_read_permissions(owner_user_id, workspace_id)
        try:
            self._db.create_document(
                DATABASE_ID, TRANSCRIPTS_COLLECTION_ID, session_id, document, permissions
            )
        except Exception as create_error:  # noqa: BLE001 - upsert fallback
            try:
                self._db.update_document(
                    DATABASE_ID, TRANSCRIPTS_COLLECTION_ID, session_id, document, permissions
                )
            except Exception as update_error:  # noqa: BLE001
                self._log.error(
                    "failed to persist transcript",
                    sessionId=session_id,
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
            if workspace_id:
                permissions.append(Permission.read(Role.team(workspace_id)))
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
        permissions = _tenant_read_permissions(owner_user_id, workspace_id)
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

    def emit_usage_event(
        self,
        session_id: str,
        survey_id: str,
        *,
        duration_ms: int,
        answered_count: int,
    ) -> None:
        """Emit the billable UsageEvent for a completed interview (ADR-0006 D6).

        Only workspace-scoped sessions that clear the prd-pricing thresholds
        (>=60s + >=1 substantive answer) are billed. The deterministic id
        ``ue_<sessionId>`` makes this idempotent: a retry/re-finalize collides
        with the existing row (409) and bills the session at most once. Never
        raises — the session is already durably completed before this runs.
        """
        if not is_billable_interview(
            state="completed", duration_ms=duration_ms, answered_count=answered_count
        ):
            return
        _owner, workspace_id = self.resolve_survey_tenancy(survey_id)
        if not workspace_id:
            # Not a workspace-scoped session (solo/legacy) -> nothing to bill.
            return
        document = usage_event_document(
            workspace_id=workspace_id,
            study_id=survey_id,
            session_id=session_id,
            occurred_at=_now_iso(),
        )
        try:
            self._db.create_document(
                DATABASE_ID, USAGE_EVENTS_COLLECTION_ID, usage_event_id(session_id), document
            )
        except Exception as error:  # noqa: BLE001
            # 409 = already billed (idempotent, expected). Any other failure must
            # not kill the completed interview; log and move on.
            self._log.warn(
                "usage event not emitted (already billed or transient)",
                sessionId=session_id,
                workspaceId=workspace_id,
                error=str(error),
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
                xasync=False,
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
