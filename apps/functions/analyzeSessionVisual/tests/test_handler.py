"""Comprehensive unit tests for handler.py — all 7 steps + error paths.

Uses in-memory fake deps to test every branch of the handler without
any SDK or network calls.
"""
from __future__ import annotations

import pytest
from src.handler import (
    ClaimResult,
    HandlerResult,
    RecordingBytes,
    RecordingRecord,
    TranscriptRecord,
    TranscriptSegment,
    VisualAnalysisOutput,
    VisualJobContext,
    _canonical_reason,
    handle,
    is_visual_recording,
    stitch_transcript,
    visual_analysis_job_id,
)


# ── Fake deps builder ────────────────────────────────────────────────

class FakeDeps:
    def __init__(self):
        self._job_context: VisualJobContext | None = VisualJobContext(
            survey_id="sv_1", owner_user_id="user_1"
        )
        self._claim_result: ClaimResult = ClaimResult(claimed=True, status="analyzing")
        self._recording: RecordingRecord | None = RecordingRecord(
            id="rec_1",
            session_id="sess_1",
            owner_user_id="user_1",
            storage_file_id="st_1",
            duration_ms=240_000,
            format="mp4",
        )
        self._transcript: TranscriptRecord | None = TranscriptRecord(
            id="tr_1",
            session_id="sess_1",
            segments=[
                TranscriptSegment(speaker="agent", start_ms=0, end_ms=5000, text="Hello"),
                TranscriptSegment(speaker="user", start_ms=5000, end_ms=10000, text="Hi there"),
            ],
            language="en",
        )
        self._media = RecordingBytes(bytes=b"fake_video_data", mime_type="video/mp4")
        self._visual_output = VisualAnalysisOutput(
            source="recording",
            recording_file_id="st_1",
            duration_ms=240_000,
            visual_confirmation=True,
            segments=[{"id": "vseg_1", "startMs": 0, "endMs": 240_000}],
            key_moments=[],
            summary="Good interview",
            sentiment="positive",
            frustration_score=0.1,
            outcome="successful",
            sentiment_signals=[],
            tags=["engaged"],
            tags_fixed=["engaged"],
            tags_freeform=[],
            highlighted=False,
            model_id="qwen3.5-omni-plus",
            generated_at="2026-06-22T00:00:00Z",
        )
        self._analyze_error: Exception | None = None
        self._job_status_calls: list[tuple] = []
        self._report_patch_calls: list[tuple] = []

    # ── Deps implementation ───────────────────────────────────────────

    def find_job_context(self, session_id: str) -> VisualJobContext | None:
        return self._job_context

    def claim_job(
        self, session_id: str, survey_id: str, owner_user_id: str, now: str
    ) -> ClaimResult:
        return self._claim_result

    def find_recording(self, session_id: str) -> RecordingRecord | None:
        return self._recording

    def find_transcript(self, session_id: str) -> TranscriptRecord | None:
        return self._transcript

    def get_recording_bytes(self, recording: RecordingRecord) -> RecordingBytes:
        return self._media

    def analyze_recording_visuals(
        self,
        recording: RecordingRecord,
        transcript: TranscriptRecord,
        media: RecordingBytes,
        survey_context: str = "",
    ) -> VisualAnalysisOutput:
        if self._analyze_error:
            raise self._analyze_error
        return self._visual_output

    def set_job_status(
        self,
        session_id: str,
        status: str,
        error_context: dict | None = None,
    ) -> None:
        self._job_status_calls.append((session_id, status, error_context))

    def patch_report_visual_analysis(
        self, session_id: str, visual: VisualAnalysisOutput
    ) -> None:
        self._report_patch_calls.append((session_id, visual))

    def now_ms(self) -> int:
        import time

        return int(time.time() * 1000)


def make_deps(**overrides) -> FakeDeps:
    deps = FakeDeps()
    for k, v in overrides.items():
        setattr(deps, k, v)
    return deps


# ── Pure helper tests ────────────────────────────────────────────────

class TestHelpers:
    def test_visual_analysis_job_id(self):
        assert visual_analysis_job_id("abc") == "vis_abc"
        assert visual_analysis_job_id("abc") == visual_analysis_job_id("abc")

    def test_is_visual_recording_mp4(self):
        r = RecordingRecord("id", "s", "o", "st", 1000, "mp4")
        assert is_visual_recording(r) is True

    def test_is_visual_recording_webm(self):
        r = RecordingRecord("id", "s", "o", "st", 1000, "webm")
        assert is_visual_recording(r) is True

    def test_is_visual_recording_audio_only(self):
        r = RecordingRecord("id", "s", "o", "st", 1000, "mp3")
        assert is_visual_recording(r) is False

    def test_stitch_transcript(self):
        tr = TranscriptRecord(
            id="t1",
            session_id="s1",
            segments=[
                TranscriptSegment(speaker="A", start_ms=0, end_ms=500, text="Q1"),
                TranscriptSegment(speaker="B", start_ms=500, end_ms=1000, text="A1"),
            ],
        )
        result = stitch_transcript(tr)
        assert "[0-500ms] A: Q1" in result
        assert "[500-1000ms] B: A1" in result

    def test_stitch_transcript_empty(self):
        tr = TranscriptRecord(id="t1", session_id="s1", segments=[])
        assert stitch_transcript(tr) == ""


# ── Handler input validation ─────────────────────────────────────────

class TestInputValidation:
    def test_rejects_missing_session_id(self):
        result = handle({}, make_deps())
        assert result.status == 400
        assert result.body["error"] == "invalid_input"

    def test_rejects_empty_session_id(self):
        result = handle({"sessionId": ""}, make_deps())
        assert result.status == 400
        assert result.body["error"] == "invalid_input"

    def test_rejects_non_string_session_id(self):
        result = handle({"sessionId": 123}, make_deps())
        assert result.status == 400
        assert result.body["error"] == "invalid_input"


# ── Step 2: session not found ────────────────────────────────────────

class TestSessionNotFound:
    def test_returns_404_when_job_context_is_none(self):
        deps = make_deps(_job_context=None)
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 404
        assert result.body["error"] == "session_not_found"


# ── Step 3: claim dedup ──────────────────────────────────────────────

class TestClaim:
    def test_skips_when_not_claimed(self):
        deps = make_deps(_claim_result=ClaimResult(claimed=False, status="analyzing"))
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["claimed"] is False
        assert result.body["jobId"] == "vis_sess_1"
        assert result.body["status"] == "analyzing"

    def test_proceeds_when_claimed(self):
        deps = make_deps()
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.body["claimed"] is True


# ── Step 4: no recording ────────────────────────────────────────────

class TestNoRecording:
    def test_succeeds_when_no_recording(self):
        deps = make_deps(_recording=None)
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["claimed"] is True
        assert result.body["status"] == "succeeded"
        assert len(deps._job_status_calls) == 1
        assert deps._job_status_calls[0][1] == "succeeded"


# ── Step 4: no transcript ───────────────────────────────────────────

class TestNoTranscript:
    def test_fails_when_no_transcript(self):
        deps = make_deps(_transcript=None)
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["status"] == "failed"
        assert result.body["claimed"] is True
        assert len(deps._job_status_calls) == 1
        assert deps._job_status_calls[0][1] == "failed"
        assert deps._job_status_calls[0][2] == {"reason": "transcript_not_found"}


# ── Step 5-6-7: happy path ──────────────────────────────────────────

class TestHappyPath:
    def test_full_flow_succeeds(self):
        deps = make_deps()
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["claimed"] is True
        assert result.body["status"] == "succeeded"
        assert result.body["jobId"] == "vis_sess_1"

    def test_patches_report(self):
        deps = make_deps()
        handle({"sessionId": "sess_1"}, deps)
        assert len(deps._report_patch_calls) == 1
        assert deps._report_patch_calls[0][0] == "sess_1"
        patched = deps._report_patch_calls[0][1]
        assert patched.source == "recording"
        assert patched.recording_file_id == "st_1"

    def test_marks_succeeded_on_completion(self):
        deps = make_deps()
        handle({"sessionId": "sess_1"}, deps)
        assert len(deps._job_status_calls) == 1
        assert deps._job_status_calls[0][1] == "succeeded"


# ── Step 5: analysis failure ────────────────────────────────────────

class TestAnalysisFailure:
    def test_records_failure_on_permanent_error(self):
        deps = make_deps(_analyze_error=RuntimeError("model timeout"))
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["status"] == "failed"
        assert deps._job_status_calls[0][1] == "failed"
        assert deps._job_status_calls[0][2]["reason"] == "transient_timeout"
        assert len(deps._report_patch_calls) == 0

    def test_records_failure_on_value_error(self):
        deps = make_deps(_analyze_error=ValueError("bad output format"))
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["status"] == "failed"
        assert deps._job_status_calls[0][2]["reason"] == "transient_unknown"

    def test_does_not_return_500_on_analysis_error(self):
        deps = make_deps(_analyze_error=Exception("anything"))
        result = handle({"sessionId": "sess_1"}, deps)
        assert result.status == 200
        assert result.body["status"] == "failed"


# ── VisualAnalysisOutput to_dict ────────────────────────────────────

class TestVisualAnalysisOutput:
    def test_to_dict_camel_case(self):
        out = VisualAnalysisOutput(
            source="recording",
            recording_file_id="rf1",
            duration_ms=1000,
            visual_confirmation=True,
            segments=[],
            key_moments=[],
            summary="Test",
            sentiment="neutral",
            frustration_score=0.0,
            outcome="successful",
            sentiment_signals=[],
            tags=[],
            tags_fixed=[],
            tags_freeform=[],
            highlighted=False,
            model_id="test-model",
            generated_at="2026-01-01T00:00:00Z",
        )
        d = out.to_dict()
        assert d["source"] == "recording"
        assert d["recordingFileId"] == "rf1"
        assert d["durationMs"] == 1000
        assert d["visualConfirmation"] is True
        assert d["modelId"] == "test-model"
        assert d["generatedAt"] == "2026-01-01T00:00:00Z"
        assert d["frustrationScore"] == 0.0
        assert d["sentimentSignals"] == []
        assert d["tagsFixed"] == []
        assert d["tagsFreeform"] == []
        assert d["highlighted"] is False
        assert "segments" in d
        assert "keyMoments" in d
        assert "summary" in d
        assert "sentiment" in d
        assert "outcome" in d
        assert "tags" in d


# ── Canonical reason codes ───────────────────────────────────────────

class TestCanonicalReason:
    def test_permanent_auth(self):
        from observability_py import PermanentProviderError

        assert _canonical_reason(PermanentProviderError("access denied: key invalid")) == "permanent_auth"
        assert _canonical_reason(PermanentProviderError("invalid_api_key")) == "permanent_auth"
        assert _canonical_reason(PermanentProviderError("Unauthorized")) == "permanent_auth"

    def test_permanent_request(self):
        from observability_py import PermanentProviderError

        assert _canonical_reason(PermanentProviderError("invalid_request: bad")) == "permanent_request"
        assert _canonical_reason(PermanentProviderError("InvalidParameter")) == "permanent_request"
        # Plain Exception with permanent marker also maps
        assert _canonical_reason(Exception("invalid_request")) == "permanent_request"

    def test_oversize_bytes(self):
        from observability_py import PermanentProviderError

        assert _canonical_reason(PermanentProviderError("video exceeds max_bytes (2147483648)")) == "oversize_bytes"
        assert _canonical_reason(PermanentProviderError("file too large: 3GB")) == "permanent_oversize"
        assert _canonical_reason(PermanentProviderError("video bytes are empty")) == "oversize_bytes"
        assert _canonical_reason(Exception("video bytes are empty")) == "oversize_bytes"

    def test_oversize_duration(self):
        from observability_py import PermanentProviderError

        assert _canonical_reason(PermanentProviderError("video exceeds max_duration (65 min)")) == "oversize_duration"

    def test_transient_rate_limit(self):
        assert _canonical_reason(Exception("throttling: too many")) == "transient_rate_limit"
        assert _canonical_reason(Exception("429 Too Many Requests")) == "transient_rate_limit"

    def test_transient_timeout(self):
        assert _canonical_reason(Exception("timed out after 30s")) == "transient_timeout"

    def test_transient_5xx(self):
        assert _canonical_reason(Exception("500 Internal Server Error")) == "transient_5xx"
        assert _canonical_reason(Exception("service unavailable")) == "transient_5xx"

    def test_transient_unknown(self):
        assert _canonical_reason(Exception("something weird happened")) == "transient_unknown"

    def test_transcript_not_found(self):
        assert _canonical_reason(Exception("transcript_not_found")) == "transcript_not_found"
