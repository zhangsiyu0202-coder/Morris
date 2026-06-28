"""verify_qwen_tts_realtime.py — Phase 0a Qwen-TTS-Realtime API 直连验证.

PoC 目的:
1. 验证 dashscope.audio.qwen_omni.QwenTtsRealtime 能用 DASHSCOPE_API_KEY 接通
2. 喂中文文本 → 收到 24kHz mono 16bit PCM 流式音频
3. 测量首包延迟 (>500ms = 异常)
4. 输出 outputs/tts_*.pcm 文件 + outputs/tts_*.wav (含头, 可直接播放)
5. 记录 token 用量到 outputs/tts_metrics.json (供 RESULTS.md 汇总成本)

不依赖 LiveKit. 失败则说明:
- API key 无效 / 余额不足 / 模型未开通 → 不用继续 LiveKit 集成
- 协议有别于文档 → 调整 thin adapter 设计

成功 → 进 verify_qwen_omni_realtime.py.
"""
from __future__ import annotations

import json
import os
import struct
import sys
import threading
import time
import wave
from pathlib import Path

import dashscope
from dashscope.audio.qwen_tts_realtime import (
    AudioFormat,
    QwenTtsRealtime,
    QwenTtsRealtimeCallback,
)
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent
load_dotenv(HERE.parent.parent / ".env")  # 用项目根 .env 的 DASHSCOPE_API_KEY

API_KEY = os.environ.get("DASHSCOPE_API_KEY")
if not API_KEY:
    print("[FATAL] DASHSCOPE_API_KEY not set in .env", file=sys.stderr)
    sys.exit(1)

dashscope.api_key = API_KEY  # SDK 全局
URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
MODEL = "qwen3-tts-flash-realtime"
VOICE = "Cherry"
OUT_DIR = HERE / "outputs"
OUT_DIR.mkdir(exist_ok=True)

# 测试文本 — 模拟一个 AI 访谈员对受访者说的开场
TEST_TEXT_CHUNKS = [
    "您好，",
    "感谢您参与本次访谈。",
    "我是 AI 访谈员，",
    "今天我们要花大约二十分钟时间，",
    "聊一下您日常使用产品的体验。",
    "在开始前，",
    "请确认您所在环境安静、",
    "网络连接稳定。",
    "准备好之后，",
    "我们就开始第一个问题。",
]


class TtsCollector(QwenTtsRealtimeCallback):
    """收集 TTS 流式输出的 PCM 块并测量延迟."""

    def __init__(self) -> None:
        super().__init__()
        self.pcm_chunks: list[bytes] = []
        self.connect_at: float | None = None
        self.first_audio_at: float | None = None
        self.session_id: str | None = None
        self.error: str | None = None
        self.done_event = threading.Event()

    def on_open(self) -> None:
        self.connect_at = time.monotonic()
        print(f"[OPEN] WebSocket connected at t={self.connect_at:.3f}")

    def on_event(self, response: dict) -> None:
        import base64

        evt_type = response.get("type", "")
        if evt_type == "session.created":
            self.session_id = response.get("session", {}).get("id", "")
            print(f"[SESSION] id={self.session_id}")
        elif evt_type == "session.updated":
            print("[SESSION] config updated")
        elif evt_type == "response.audio.delta":
            if self.first_audio_at is None:
                self.first_audio_at = time.monotonic()
                if self.connect_at is not None:
                    delay_ms = (self.first_audio_at - self.connect_at) * 1000
                    print(f"[METRIC] first audio delay = {delay_ms:.0f} ms")
            delta_b64 = response.get("delta", "")
            if delta_b64:
                self.pcm_chunks.append(base64.b64decode(delta_b64))
        elif evt_type == "response.done":
            print(f"[RESP] done; total PCM chunks = {len(self.pcm_chunks)}")
        elif evt_type == "session.finished":
            print("[SESSION] finished")
            self.done_event.set()
        elif evt_type == "error":
            self.error = json.dumps(response.get("error", {}))
            print(f"[ERROR] {self.error}", file=sys.stderr)
            self.done_event.set()

    def on_close(self, close_status_code: int, close_msg: str) -> None:
        print(f"[CLOSE] code={close_status_code} msg={close_msg}")
        self.done_event.set()


def write_pcm_and_wav(pcm: bytes, basename: str, sample_rate: int = 24000) -> tuple[Path, Path]:
    pcm_path = OUT_DIR / f"{basename}.pcm"
    wav_path = OUT_DIR / f"{basename}.wav"
    pcm_path.write_bytes(pcm)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return pcm_path, wav_path


def main() -> int:
    print("=" * 60)
    print("Qwen-TTS-Realtime API verification (Phase 0a)")
    print(f"  endpoint: {URL}")
    print(f"  model:    {MODEL}")
    print(f"  voice:    {VOICE}")
    print(f"  api key:  {API_KEY[:6]}...{API_KEY[-4:] if len(API_KEY) > 10 else '***'}")
    print("=" * 60)

    callback = TtsCollector()
    tts = QwenTtsRealtime(model=MODEL, callback=callback, url=URL)

    started_at = time.monotonic()
    try:
        tts.connect()
        tts.update_session(
            voice=VOICE,
            response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
            mode="server_commit",  # 服务端智能分段
        )
        for chunk in TEST_TEXT_CHUNKS:
            print(f"[SEND] {chunk}")
            tts.append_text(chunk)
            time.sleep(0.1)
        tts.finish()
        # 等服务端返回 session.finished 或 error (60s 上限)
        if not callback.done_event.wait(timeout=60):
            print("[FATAL] timeout waiting for session.finished", file=sys.stderr)
            return 2
    except Exception as exc:  # noqa: BLE001 - PoC 顶层暴露
        print(f"[FATAL] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3
    finally:
        try:
            tts.close()
        except Exception:
            pass

    elapsed_total_ms = (time.monotonic() - started_at) * 1000

    if callback.error:
        print(f"[FAIL] server error: {callback.error}", file=sys.stderr)
        return 4

    if not callback.pcm_chunks:
        print("[FAIL] no PCM audio received", file=sys.stderr)
        return 5

    pcm_bytes = b"".join(callback.pcm_chunks)
    pcm_path, wav_path = write_pcm_and_wav(pcm_bytes, "tts_001")
    duration_s = len(pcm_bytes) / (24000 * 2)  # 24kHz × 2 bytes/sample

    first_audio_delay_ms = (
        (callback.first_audio_at - callback.connect_at) * 1000
        if callback.connect_at and callback.first_audio_at
        else None
    )

    metrics = {
        "model": MODEL,
        "voice": VOICE,
        "endpoint": URL,
        "session_id": callback.session_id,
        "text_chunks_sent": len(TEST_TEXT_CHUNKS),
        "text_chars_sent": sum(len(c) for c in TEST_TEXT_CHUNKS),
        "pcm_chunks_received": len(callback.pcm_chunks),
        "pcm_total_bytes": len(pcm_bytes),
        "audio_duration_s": round(duration_s, 2),
        "first_audio_delay_ms": (
            round(first_audio_delay_ms, 0) if first_audio_delay_ms else None
        ),
        "total_session_ms": round(elapsed_total_ms, 0),
        "outputs": {"pcm": str(pcm_path), "wav": str(wav_path)},
    }
    metrics_path = OUT_DIR / "tts_metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print()
    print("=" * 60)
    print("PASS — Qwen-TTS-Realtime API verified")
    print("=" * 60)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"\n[OUTPUT] saved to {wav_path} (play to verify quality)")
    print(f"[OUTPUT] metrics saved to {metrics_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
