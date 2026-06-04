"""Transcript accumulation for an interview session.

The engine subscribes to livekit ``AgentSession`` transcription / conversation
events and forwards finalized turns here. ``TranscriptCollector`` is pure (no
livekit imports) so it can be unit tested directly, and it produces
``TranscriptSegment`` contracts ready to persist to Appwrite.
"""
from __future__ import annotations

from agent.contracts import TranscriptSegment

SPEAKER_AGENT = "agent"
SPEAKER_INTERVIEWEE = "interviewee"


class TranscriptCollector:
    """Append-only, monotonic buffer of transcript segments."""

    def __init__(self) -> None:
        self._segments: list[TranscriptSegment] = []

    def add(self, *, speaker: str, start_ms: int, end_ms: int, text: str) -> TranscriptSegment | None:
        """Add a finalized turn. Blank text is ignored; timing is clamped so
        ``endMs >= startMs >= 0`` to keep segments monotonic for the analysis
        module's citation indexing.
        """
        cleaned = text.strip()
        if not cleaned:
            return None
        safe_start = max(0, start_ms)
        safe_end = max(safe_start, end_ms)
        segment = TranscriptSegment(
            speaker=speaker,
            startMs=safe_start,
            endMs=safe_end,
            text=cleaned,
        )
        self._segments.append(segment)
        return segment

    def add_segment(self, segment: TranscriptSegment) -> None:
        if segment.text.strip():
            self._segments.append(segment)

    def snapshot(self) -> list[TranscriptSegment]:
        """Return a shallow copy of the buffered segments."""
        return list(self._segments)

    def __len__(self) -> int:
        return len(self._segments)

    @property
    def is_empty(self) -> bool:
        return not self._segments
