"""Unit tests for OpenCC interviewee-side normalization in TranscriptCollector.

The Gemini Live API in AI Studio mode auto-detects Mandarin audio as Traditional
Chinese on `input_audio_transcription`. We fix that downstream because the AI
Studio API rejects `AudioTranscriptionConfig.language_codes`. These tests pin
the policy so a future refactor can't silently lose it.
"""
from __future__ import annotations

import pytest

from agent.interview.transcript import (
    SPEAKER_AGENT,
    SPEAKER_INTERVIEWEE,
    TranscriptCollector,
    normalize_interviewee_text,
)


# --- normalize_interviewee_text -----------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        # actual sample observed in agent-dev.log on 2026-06-15
        (
            "我是同事在群裡推薦我用的速達外賣,新人紅包很大。",
            "我是同事在群里推荐我用的速达外卖,新人红包很大。",
        ),
        ("我下載的最主要動機就是新人紅包。", "我下载的最主要动机就是新人红包。"),
        # already-Simplified — must be a no-op
        (
            "你好，我想问一下，你是怎么知道速达外卖这个 App 的？",
            "你好，我想问一下，你是怎么知道速达外卖这个 App 的？",
        ),
        # pure simplified
        ("速达外卖新人红包很大", "速达外卖新人红包很大"),
        # pure ASCII — no-op
        ("hello world", "hello world"),
        # empty — no-op
        ("", ""),
    ],
)
def test_normalize_interviewee_text(raw: str, expected: str) -> None:
    assert normalize_interviewee_text(raw) == expected


def test_normalize_is_idempotent() -> None:
    """Running t2s twice must not change the result (already-simplified)."""
    raw = "我是同事在群裡推薦我用的速達外賣"
    once = normalize_interviewee_text(raw)
    twice = normalize_interviewee_text(once)
    assert once == twice


# --- TranscriptCollector integration ------------------------------------------


def test_collector_normalizes_interviewee_only() -> None:
    c = TranscriptCollector()
    # Agent text (already simplified, but pretend it could be mixed) — we do NOT
    # transform agent-side text; per gemini.py docstring, output_audio_transcription
    # mirrors the LLM's text output which is simplified.
    a = c.add(
        speaker=SPEAKER_AGENT,
        start_ms=0,
        end_ms=100,
        text="你好，我们开始吧。",
    )
    # Interviewee text in Traditional — must come back simplified.
    u = c.add(
        speaker=SPEAKER_INTERVIEWEE,
        start_ms=200,
        end_ms=300,
        text="我是同事在群裡推薦的。",
    )
    assert a is not None and a.text == "你好，我们开始吧。"
    assert u is not None and u.text == "我是同事在群里推荐的。"


def test_collector_blank_text_returns_none() -> None:
    c = TranscriptCollector()
    assert c.add(speaker=SPEAKER_INTERVIEWEE, start_ms=0, end_ms=10, text="   ") is None
    assert c.is_empty


def test_collector_clamps_timing() -> None:
    c = TranscriptCollector()
    seg = c.add(speaker=SPEAKER_INTERVIEWEE, start_ms=-5, end_ms=-10, text="测试")
    assert seg is not None
    assert seg.startMs == 0
    assert seg.endMs == 0
