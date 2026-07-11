"""verify_qwen_omni_realtime.py — Phase 0a Qwen-Omni-Realtime API 直连验证.

PoC 目的:
1. 验证 dashscope.audio.qwen_omni.OmniRealtimeConversation 能用 DASHSCOPE_API_KEY 接通
2. 喂 P1 生成的 outputs/tts_001.pcm (24kHz 中文语音, downsample 到 16kHz) 作为受访者音频输入
3. 验证 modalities=['text'] 输出文本 (不要音频)
4. 验证 instructions 参数 (system prompt) 透传 — 让 agent 自报家门匹配 instruction
5. 验证 ASR 转录 (input_audio_transcription) 能拿到受访者音频文字
6. 测量首文本延迟
7. 记录 token 用量到 outputs/omni_metrics.json

成功标准:
- modalities=['text'] 设置生效, response.audio.delta 不出现
- response.text.delta 流式收到
- 输出文本应该承接 instruction 中"你是 X" 的设定
- ASR 转录文本应该匹配 P1 合成的中文 (验证 16kHz downsample 没坏)

失败 → 协议有别于 OpenAI Realtime, hybrid 接入 LiveKit 要写更厚的 adapter.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
import wave
from pathlib import Path

import dashscope
import numpy as np
from dashscope.audio.qwen_omni import (
    AudioFormat,
    MultiModality,
    OmniRealtimeCallback,
    OmniRealtimeConversation,
)
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent.parent / ".env")

API_KEY = os.environ.get("DASHSCOPE_API_KEY")
if not API_KEY:
    print("[FATAL] DASHSCOPE_API_KEY not set in .env", file=sys.stderr)
    sys.exit(1)

dashscope.api_key = API_KEY
URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
MODEL = "qwen3-omni-flash-realtime"  # flash 价格更低先试
OUT_DIR = HERE / "outputs"
INPUT_PCM = OUT_DIR / "tts_001.pcm"  # P1 生成的 24kHz mono 16bit PCM

# 模拟 supervisorRole — 系统 prompt
INSTRUCTIONS = (
    "你是一个名叫小绿的 AI 访谈员。"
    "无论用户说什么,你都要在第一句回答里明确说出'我是小绿'这五个字。"
    "之后再正常对话,保持简洁。"
)


def downsample_24k_to_16k(pcm_24k: bytes) -> bytes:
    """24kHz → 16kHz 线性插值 downsample (PCM s16 mono)."""
    samples_24k = np.frombuffer(pcm_24k, dtype=np.int16)
    n_24k = len(samples_24k)
    n_16k = int(n_24k * 16000 / 24000)
    indices_16k = np.linspace(0, n_24k - 1, n_16k)
    samples_16k = np.interp(indices_16k, np.arange(n_24k), samples_24k.astype(np.float32))
    return samples_16k.astype(np.int16).tobytes()


def write_wav(pcm: bytes, path: Path, sample_rate: int) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)


class OmniCollector(OmniRealtimeCallback):
    def __init__(self) -> None:
        super().__init__()
        self.connect_at: float | None = None
        self.first_text_at: float | None = None
        self.session_id: str | None = None
        self.text_chunks: list[str] = []
        self.input_transcript_chunks: list[str] = []
        self.audio_delta_count = 0  # 应该是 0 (modalities=['text'])
        self.usage: dict | None = None
        self.error: str | None = None
        self.done_event = threading.Event()
        self.events_log: list[dict] = []

    def on_open(self) -> None:
        self.connect_at = time.monotonic()
        print(f"[OPEN] WebSocket connected at t={self.connect_at:.3f}")

    def on_event(self, response: dict) -> None:
        evt_type = response.get("type", "")
        # 记一份精简版事件日志,排错用 (省略 audio.delta 大字段)
        if evt_type != "response.audio.delta":
            self.events_log.append(
                {"type": evt_type, "keys": sorted(response.keys())}
            )
        if evt_type == "session.created":
            self.session_id = response.get("session", {}).get("id", "")
            print(f"[SESSION] id={self.session_id}")
        elif evt_type == "session.updated":
            sess = response.get("session", {})
            print(f"[SESSION] updated; modalities={sess.get('modalities')} "
                  f"voice={sess.get('voice')}")
        elif evt_type == "input_audio_buffer.speech_started":
            print("[ASR] speech started")
        elif evt_type == "input_audio_buffer.speech_stopped":
            print("[ASR] speech stopped")
        elif evt_type == "input_audio_buffer.committed":
            print("[ASR] buffer committed")
        elif evt_type == "conversation.item.input_audio_transcription.delta":
            preview = response.get("text", "") + response.get("stash", "")
            print(f"\r[ASR] {preview}", end="", flush=True)
        elif evt_type == "conversation.item.input_audio_transcription.completed":
            transcript = response.get("transcript", "")
            self.input_transcript_chunks.append(transcript)
            print(f"\n[ASR-DONE] {transcript}")
        elif evt_type == "response.created":
            print("[RESP] created")
        elif evt_type == "response.text.delta":
            if self.first_text_at is None:
                self.first_text_at = time.monotonic()
                if self.connect_at:
                    print(f"\n[METRIC] first text delay = "
                          f"{(self.first_text_at - self.connect_at) * 1000:.0f} ms")
            delta = response.get("delta", "")
            self.text_chunks.append(delta)
            print(delta, end="", flush=True)
        elif evt_type == "response.text.done":
            print("\n[RESP] text done")
        elif evt_type == "response.audio.delta":
            # 配置了 modalities=['text'], 不该出现
            self.audio_delta_count += 1
        elif evt_type == "response.audio_transcript.delta":
            # 也不该出现 (那是音频输出的转录)
            pass
        elif evt_type == "response.done":
            resp = response.get("response", {})
            self.usage = resp.get("usage")
            print(f"\n[RESP] done; usage={self.usage}")
            self.done_event.set()
        elif evt_type == "error":
            self.error = json.dumps(response.get("error", {}), ensure_ascii=False)
            print(f"\n[ERROR] {self.error}", file=sys.stderr)
            self.done_event.set()

    def on_close(self, close_status_code: int, close_msg: str) -> None:
        print(f"[CLOSE] code={close_status_code} msg={close_msg}")


def main() -> int:
    print("=" * 60)
    print("Qwen-Omni-Realtime API verification (Phase 0a)")
    print(f"  endpoint: {URL}")
    print(f"  model:    {MODEL}")
    print("=" * 60)

    if not INPUT_PCM.exists():
        print(f"[FATAL] {INPUT_PCM} not found. Run verify_qwen_tts_realtime.py first.",
              file=sys.stderr)
        return 1

    # Step 1: 加载 + downsample 24k→16k
    pcm_24k = INPUT_PCM.read_bytes()
    pcm_16k = downsample_24k_to_16k(pcm_24k)
    pcm_16k_path = OUT_DIR / "tts_001_16k.pcm"
    pcm_16k_path.write_bytes(pcm_16k)
    write_wav(pcm_16k, OUT_DIR / "tts_001_16k.wav", 16000)
    print(f"[INPUT] downsampled {len(pcm_24k)} bytes (24k) -> "
          f"{len(pcm_16k)} bytes (16k)")
    print(f"[INPUT] saved to {pcm_16k_path}")

    callback = OmniCollector()
    conv = OmniRealtimeConversation(model=MODEL, callback=callback, url=URL)

    started_at = time.monotonic()
    try:
        conv.connect()
        # 关键: modalities=[TEXT] (不含 AUDIO), instructions 透传 supervisorRole
        conv.update_session(
            output_modalities=[MultiModality.TEXT],
            voice="Ethan",  # 占位: Qwen-Omni 即使 text-only 也要 voice 非 null
            instructions=INSTRUCTIONS,
            input_audio_format=AudioFormat.PCM_16000HZ_MONO_16BIT,
            enable_input_audio_transcription=True,
            input_audio_transcription_model="qwen3-asr-flash-realtime",
            enable_turn_detection=False,  # manual: append + commit + create_response
        )
        # Step 2: 把 16kHz PCM 分块 send (每块 200ms = 6400 bytes)
        chunk_size = 6400
        total_chunks = (len(pcm_16k) + chunk_size - 1) // chunk_size
        print(f"[SEND] streaming {total_chunks} chunks of {chunk_size} bytes")
        for i in range(0, len(pcm_16k), chunk_size):
            chunk = pcm_16k[i:i + chunk_size]
            conv.append_audio(base64.b64encode(chunk).decode())
            time.sleep(0.05)  # 模拟实时
        # Step 3: manual mode commit + create response
        conv.commit()
        conv.create_response()
        # Step 4: 等 response.done
        if not callback.done_event.wait(timeout=60):
            print("\n[FATAL] timeout waiting for response.done", file=sys.stderr)
            return 2
    except Exception as exc:  # noqa: BLE001
        print(f"\n[FATAL] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3
    finally:
        try:
            conv.close()
        except Exception:
            pass

    elapsed_ms = (time.monotonic() - started_at) * 1000

    if callback.error:
        print(f"[FAIL] server error: {callback.error}", file=sys.stderr)
        return 4

    full_text = "".join(callback.text_chunks)
    full_input_transcript = "".join(callback.input_transcript_chunks)
    first_text_delay_ms = (
        (callback.first_text_at - callback.connect_at) * 1000
        if callback.connect_at and callback.first_text_at
        else None
    )

    metrics = {
        "model": MODEL,
        "endpoint": URL,
        "session_id": callback.session_id,
        "input_audio_seconds": round(len(pcm_16k) / (16000 * 2), 2),
        "input_transcript": full_input_transcript,
        "instructions_sent": INSTRUCTIONS,
        "output_text": full_text,
        "output_text_chars": len(full_text),
        "audio_delta_received": callback.audio_delta_count,
        "first_text_delay_ms": (
            round(first_text_delay_ms, 0) if first_text_delay_ms else None
        ),
        "total_session_ms": round(elapsed_ms, 0),
        "usage": callback.usage,
        "events_seen": [e["type"] for e in callback.events_log],
    }

    # 校验
    checks = {
        "session_created": callback.session_id is not None,
        "got_input_transcript": len(full_input_transcript) > 0,
        "got_text_output": len(full_text) > 0,
        "no_audio_delta_when_text_only": callback.audio_delta_count == 0,
        "instructions_honored": "小绿" in full_text,  # instruction 要求第一句说出
        "asr_recognized_zh": (
            "访谈" in full_input_transcript or "AI" in full_input_transcript
        ),
    }
    metrics["checks"] = checks
    metrics["all_checks_passed"] = all(checks.values())

    metrics_path = OUT_DIR / "omni_metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print()
    print("=" * 60)
    print("CHECKS:")
    for name, ok in checks.items():
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print("=" * 60)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"\n[OUTPUT] metrics saved to {metrics_path}")
    return 0 if metrics["all_checks_passed"] else 5


if __name__ == "__main__":
    sys.exit(main())
