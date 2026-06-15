"""Synthesize a long Chinese WAV file for Playwright's --use-file-for-fake-audio-capture.

Concatenates scripted-answer phrases via Gemini 2.5 Flash TTS (REST, free tier),
separated by ~30s silence so the agent has time to speak between answers.
Output is 24 kHz / 16-bit / mono PCM wrapped in a WAV header — exactly what
Chromium's fake-audio-capture flag accepts.

Run:
    cd apps/agent
    uv run python -m tests.load.synth_fake_mic [--out PATH] [--phrases N]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


GEMINI_TTS_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-preview-tts:generateContent?key={key}"
)
SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2  # 16-bit


# Picked from SCRIPTED_ANSWERS. Short, distinct phrases the agent can latch onto.
PHRASES = [
    "你好，我准备好了，可以开始访谈了。",
    "我是同事在群里推荐我用的速达外卖，新人红包很大。",
    "我下载的最主要动机就是新人红包。",
    "我给安装到下第一单这个流程打四分。",
    "扣分主要是定位偏了一个园区，我得手动搜公司全名。",
    "我下单的时候最看评分和评论数，配送时长也很关键。",
    "我的优先级是配送时长、然后总价、再口味、最后是距离。",
    "中午我能容忍的配送时长是三十一到四十五分钟。",
    "速达上同样的店常常便宜五到十块，新人红包还能再省一波。",
    "我打七分推荐速达，主要是商家覆盖度还不够，特别是精品咖啡。",
]


def _silence_pcm(seconds: float) -> bytes:
    n_samples = int(seconds * SAMPLE_RATE)
    return b"\x00\x00" * n_samples


def _wav_header(pcm_byte_len: int) -> bytes:
    """Standard 16-bit mono PCM WAV header for the given payload length."""
    chunk_size = 36 + pcm_byte_len
    return (
        b"RIFF" + struct.pack("<I", chunk_size) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH",
            16, 1, 1, SAMPLE_RATE,
            SAMPLE_RATE * BYTES_PER_SAMPLE, BYTES_PER_SAMPLE, 16)
        + b"data" + struct.pack("<I", pcm_byte_len)
    )


class TTSError(Exception):
    """Raised when the API responds but the candidate has no audio content."""


def synth_pcm(text: str, api_key: str, voice: str = "Charon", *, attempts: int = 3) -> bytes:
    """Call Gemini TTS; return raw 24kHz/16-bit PCM bytes. Retries on transient
    failures (HTTP 429 / 5xx, missing content)."""
    body = json.dumps({
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
    }).encode("utf-8")
    last_err: str = ""
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            GEMINI_TTS_URL.format(key=api_key),
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code in (429, 500, 502, 503, 504) and attempt < attempts:
                time.sleep(2 ** attempt)  # 2,4,8 seconds
                continue
            raise
        cand = data.get("candidates", [{}])[0]
        finish = cand.get("finishReason", "")
        content = cand.get("content")
        if content is None:
            last_err = f"no content (finishReason={finish}, keys={list(cand.keys())})"
            if attempt < attempts:
                time.sleep(2 ** attempt)
                continue
            raise TTSError(last_err)
        parts = content.get("parts") or []
        if not parts:
            last_err = "empty parts"
            if attempt < attempts:
                time.sleep(2 ** attempt)
                continue
            raise TTSError(last_err)
        inline = parts[0].get("inlineData") or {}
        if not inline.get("mimeType", "").startswith("audio/L16"):
            raise RuntimeError(f"unexpected mime type: {inline.get('mimeType')}")
        return base64.b64decode(inline["data"])
    raise TTSError(last_err)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/tmp/merism/fake_mic.wav")
    parser.add_argument("--phrases", type=int, default=10,
                        help="how many phrases (1..len PHRASES)")
    parser.add_argument("--silence-sec", type=float, default=30.0,
                        help="silence between phrases (gives agent time to talk)")
    parser.add_argument("--lead-silence-sec", type=float, default=5.0,
                        help="leading silence before any speech")
    parser.add_argument("--voice", default="Charon")
    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GOOGLE_API_KEY (or GEMINI_API_KEY) not set")

    n = max(1, min(args.phrases, len(PHRASES)))
    selected = PHRASES[:n]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"=== synth_fake_mic ===", flush=True)
    print(f"phrases  : {n}", flush=True)
    print(f"voice    : {args.voice}", flush=True)
    print(f"silence  : lead={args.lead_silence_sec}s, between={args.silence_sec}s", flush=True)
    print(f"output   : {out_path}", flush=True)
    print("", flush=True)

    parts: list[bytes] = [_silence_pcm(args.lead_silence_sec)]
    total_started = time.monotonic()
    for i, text in enumerate(selected, start=1):
        t0 = time.monotonic()
        try:
            pcm = synth_pcm(text, api_key, voice=args.voice)
        except (urllib.error.HTTPError, TTSError) as e:
            print(f"  [{i}/{n}] FAILED ({type(e).__name__}): {e!s}; skipping", flush=True)
            continue
        secs = len(pcm) / (SAMPLE_RATE * BYTES_PER_SAMPLE)
        print(f"  [{i}/{n}] '{text[:30]}…' -> {secs:.1f}s pcm "
              f"({len(pcm)/1024:.0f} KB) in {time.monotonic()-t0:.1f}s", flush=True)
        parts.append(pcm)
        if i < n:
            parts.append(_silence_pcm(args.silence_sec))

    pcm_blob = b"".join(parts)
    duration_sec = len(pcm_blob) / (SAMPLE_RATE * BYTES_PER_SAMPLE)
    out_path.write_bytes(_wav_header(len(pcm_blob)) + pcm_blob)

    print("", flush=True)
    print(f"=== done ===", flush=True)
    print(f"duration : {duration_sec:.1f}s = {duration_sec/60:.1f} min", flush=True)
    print(f"file size: {out_path.stat().st_size/1024/1024:.2f} MB", flush=True)
    print(f"wall     : {time.monotonic()-total_started:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
