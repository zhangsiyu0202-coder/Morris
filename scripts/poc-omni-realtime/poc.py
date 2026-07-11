"""poc.py — Phase 0b: LiveKit hybrid AgentSession 端到端集成脚本.

架构:
    受访者麦克风 ──→ LiveKit room ──→ Agent worker
                                       │
                                       ↓
                       Qwen-Omni-Realtime (modalities=["text"])
                       通过 livekit-plugins-openai::RealtimeModel + base_url override
                       内置 ASR + LLM, 输出纯文本
                                       │
                                       ↓
                       QwenTtsRealtimeTTS (我们写的 thin adapter)
                       接收文本流, 用 dashscope SDK 调 Qwen-TTS-Realtime
                       输出 24kHz mono 16bit PCM
                                       │
                                       ↓
                                 LiveKit room → 受访者扬声器

跑法:
    cd scripts/poc-omni-realtime
    source .venv/bin/activate

    # console 模式 (本地终端 + 麦克风 + 扬声器, 最简易):
    python poc.py console

    # dev 模式 (worker, 配合 LiveKit room 用):
    python poc.py dev
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.plugins import openai, silero

HERE = Path(__file__).parent
load_dotenv(HERE.parent.parent / ".env")

logger = logging.getLogger("poc-omni-realtime")
logging.basicConfig(level=logging.INFO)

from qwen_tts_realtime_tts import QwenTtsRealtimeTTS  # noqa: E402

# Qwen-Omni-Realtime 端点
QWEN_OMNI_BASE_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
QWEN_OMNI_MODEL = "qwen3-omni-flash-realtime"

# 模拟 supervisorRole — 在生产里这一段会从 InterviewWorkflowConfig.supervisorRole 拿
INSTRUCTIONS = (
    "你是一个名叫小绿的 AI 访谈员。"
    "保持友好、简洁、口语化。"
    "在第一轮回应里明确说出'我是小绿'这五个字, 之后正常对话。"
    "如果用户问起你的能力, 简单介绍你能听他说话、回答问题、引导访谈。"
)


class InterviewerAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INSTRUCTIONS)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    api_key = os.environ["DASHSCOPE_API_KEY"]

    session = AgentSession(
        # Qwen-Omni-Realtime via OpenAI plugin (hybrid: text-only output)
        llm=openai.realtime.RealtimeModel(
            base_url=QWEN_OMNI_BASE_URL,
            api_key=api_key,
            model=QWEN_OMNI_MODEL,
            modalities=["text"],  # 纯文本输出, 不要 Omni 自带音频
            voice="Ethan",  # quirk: Qwen-Omni 即使 text-only 也强制要 voice 非 null
        ),
        # 外置 TTS via 我们自己写的 thin adapter
        tts=QwenTtsRealtimeTTS(
            api_key=api_key,
            voice="Cherry",
        ),
        # silero VAD 给本地 turn detection 兜底 (manual mode 时用)
        vad=silero.VAD.load(),
    )

    await session.start(
        agent=InterviewerAgent(),
        room=ctx.room,
    )

    # Initial greeting — 测试 instructions 透传
    await session.generate_reply(
        instructions="问候用户, 自我介绍, 然后问一个开场问题",
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
