"""Pure serialization for Appwrite documents (no SDK import).

Field names / JSON shapes mirror packages/appwrite-schema schema.ts so the
documents written by the agent match the declared collections. Kept side-effect
free for unit testing; the repository (appwrite_repository.py) wraps these with
the lazy Appwrite SDK.
"""
from __future__ import annotations

import json
from collections.abc import Sequence

from agent.contracts import SessionState, TranscriptSegment

DATABASE_ID = "merism"
TRANSCRIPTS_COLLECTION_ID = "transcripts"
SESSIONS_COLLECTION_ID = "interview_sessions"


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
