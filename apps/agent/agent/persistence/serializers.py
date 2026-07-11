"""Pure serialization for Appwrite documents (no SDK import).

Field names / JSON shapes mirror packages/appwrite-schema schema.ts so the
documents written by the agent match the declared collections. Kept side-effect
free for unit testing; the repository (appwrite_repository.py) wraps these with
the lazy Appwrite SDK.
"""
from __future__ import annotations

import json
from collections.abc import Sequence

from agent.contracts import RecordingFormat, SessionState, TranscriptSegment

DATABASE_ID = "merism"
TRANSCRIPTS_COLLECTION_ID = "transcripts"
SESSIONS_COLLECTION_ID = "interview_sessions"
RECORDINGS_COLLECTION_ID = "recordings"
SURVEYS_COLLECTION_ID = "surveys"
USAGE_EVENTS_COLLECTION_ID = "usage_events"
RECORDINGS_BUCKET_ID = "recordings"


def usage_event_document(
    *,
    workspace_id: str,
    study_id: str,
    session_id: str,
    occurred_at: str,
) -> dict[str, object]:
    """Build a ``usage_events`` document body (ADR-0006 D6 billable unit)."""
    return {
        "workspaceId": workspace_id,
        "studyId": study_id,
        "sessionId": session_id,
        "unit": "completed_interview",
        "occurredAt": occurred_at,
    }


def transcript_document(
    *,
    session_id: str,
    segments: Sequence[TranscriptSegment],
    language: str,
    finalized_at: str,
) -> dict[str, object]:
    """Build a ``transcripts`` document body (segments stored as a JSON string)."""
    return {
        "sessionId": session_id,
        "segments": json.dumps([segment.model_dump() for segment in segments], ensure_ascii=False),
        "language": language,
        "finalizedAt": finalized_at,
    }


def session_progress_fields(
    *,
    state: SessionState,
    started_at: str | None = None,
) -> dict[str, object]:
    """Partial ``interview_sessions`` update for a state transition."""
    fields: dict[str, object] = {"state": state}
    if started_at is not None:
        fields["startedAt"] = started_at
    return fields


def session_completion_fields(
    *,
    collected_answers: dict[str, object],
    ended_at: str,
    state: SessionState = "completed",
) -> dict[str, object]:
    """Partial ``interview_sessions`` update when the interview finishes."""
    return {
        "state": state,
        "collectedAnswers": json.dumps(collected_answers, ensure_ascii=False),
        "endedAt": ended_at,
    }


def session_failure_fields(
    *,
    error_context: dict[str, object],
    ended_at: str,
) -> dict[str, object]:
    """Partial ``interview_sessions`` update for a failed interview."""
    return {
        "state": "failed",
        "errorContext": json.dumps(error_context, ensure_ascii=False),
        "endedAt": ended_at,
    }


def recording_document(
    *,
    session_id: str,
    owner_user_id: str,
    storage_file_id: str,
    duration_ms: int,
    format: RecordingFormat,
) -> dict[str, object]:
    """Build a ``recordings`` collection document body."""
    return {
        "sessionId": session_id,
        "ownerUserId": owner_user_id,
        "storageFileId": storage_file_id,
        "durationMs": duration_ms,
        "format": format,
    }
