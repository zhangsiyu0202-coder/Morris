"""verify_tts_adapter_standalone.py — Phase 0a.5: 不通过 LiveKit AgentSession,
直接驱动 QwenTtsRealtimeTTS 一次 synthesize() 验证 adapter 自身能跑.

意义: 在用户用麦克风跑端到端前, 先确认 thin adapter 写对了 — 避免后面调试时
分不清是 adapter 问题还是 LiveKit 集成问题.
"""
from __future__ import annotations

import asyncio
import os
import sys
import wave
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import tts as lk_tts

HERE = Path(__file__).parent
load_dotenv(HERE.parent.parent / ".env")

if not os.environ.get("DASHSCOPE_API_KEY"):
    print("[FATAL] DASHSCOPE_API_KEY not set", file=sys.stderr)
    sys.exit(1)

from qwen_tts_realtime_tts import QwenTtsRealtimeTTS  # noqa: E402

OUT_DIR = HERE / "outputs"
OUT_DIR.mkdir(exist_ok=True)


async def main() -> int:
    text = (
        "你好,我是 AI 访谈员小绿。"
        "我们今天通过 LiveKit Adapter 测试一下语音合成是否流畅。"
        "如果你能听到这段话,说明 hybrid 路径已经打通。"
    )
    tts_instance = QwenTtsRealtimeTTS(voice="Cherry")

    print(f"[TEST] synthesize(): {len(text)} chars")
    stream = tts_instance.synthesize(text)
    # collect() 是 LiveKit ChunkedStream 的 helper, 把所有 chunks 聚合成一个 SynthesizedAudio
    synthesized = await stream.collect()
    pcm_bytes = bytes(synthesized.data)

    out_wav = OUT_DIR / "adapter_test.wav"
    with wave.open(str(out_wav), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16bit
        wf.setframerate(24000)
        wf.writeframes(pcm_bytes)

    duration_s = len(pcm_bytes) / (24000 * 2)
    print(f"[PASS] adapter produced {len(pcm_bytes)} bytes ({duration_s:.2f}s)")
    print(f"[OUTPUT] {out_wav}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
