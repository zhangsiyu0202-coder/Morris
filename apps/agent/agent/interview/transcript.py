"""Transcript accumulation for an interview session.

The engine subscribes to livekit ``AgentSession`` transcription / conversation
events and forwards finalized turns here. ``TranscriptCollector`` is pure (no
livekit imports) so it can be unit tested directly, and it produces
``TranscriptSegment`` contracts ready to persist to Appwrite.

Interviewee text is run through OpenCC ``t2s`` before storage. Empirically the
Gemini Live ASR ``input_audio_transcription`` channel returns Traditional
Chinese for Mandarin audio in AI Studio mode (Vertex AI mode would let us pin
``language_codes=["zh-CN"]`` on the config but AI Studio rejects that kwarg).
Agent text already arrives in Simplified because ``output_audio_transcription``
mirrors the LLM's text output, which is Simplified given our system prompt;
OpenCC ``t2s`` is a no-op on already-Simplified content so applying it is safe
even if the upstream behaviour stabilizes later.
"""
from __future__ import annotations

from functools import lru_cache

from agent.contracts import TranscriptSegment

SPEAKER_AGENT = "agent"
SPEAKER_INTERVIEWEE = "interviewee"


@lru_cache(maxsize=1)
def _t2s_converter():
    """Build the OpenCC Traditional→Simplified converter once per process.

    Lazy + cached because: (a) construction reads dictionary files and is the
    heavy part; (b) importing opencc at module load would slow tests that do
    not exercise the transcript path.
    """
    from opencc import OpenCC

    return OpenCC("t2s")


def normalize_interviewee_text(text: str) -> str:
    """Coerce interviewee transcript to Simplified Chinese.

    Idempotent: already-Simplified text round-trips unchanged. Pure ASCII /
    non-Chinese text round-trips unchanged. Pure helper so the engine and tests
    can call it without instantiating a TranscriptCollector.
    """
    if not text:
        return text
    return _t2s_converter().convert(text)


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
        if speaker == SPEAKER_INTERVIEWEE:
            cleaned = normalize_interviewee_text(cleaned)
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
