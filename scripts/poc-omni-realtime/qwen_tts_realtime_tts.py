"""qwen_tts_realtime_tts.py — Thin LiveKit TTS plugin for Qwen-TTS-Realtime.

包装 dashscope.audio.qwen_tts_realtime.QwenTtsRealtime 成 livekit.agents.tts.TTS
接口, 让 LiveKit hybrid 模式能拿来当外置 TTS:

    session = AgentSession(
        llm=openai.realtime.RealtimeModel(modalities=["text"], ...),
        tts=QwenTtsRealtimeTTS(api_key=..., voice="Cherry"),
    )

设计要点 (借鉴 livekit-plugins-elevenlabs/livekit/plugins/elevenlabs/tts.py):

1. 继承 livekit.agents.tts.TTS, capabilities=streaming + 显式 NotStreamed (per-call WS)
2. synthesize(text) 每次开新 QwenTtsRealtime session, server_commit 模式喂全文, 等
   完整音频回来 (chunk 模式更适合 LiveKit 的 ChunkedStream pattern)
3. response.audio.delta 回调把 base64 PCM 解码成 24kHz mono 16bit, 包成 LiveKit
   AudioFrame, push 到 SynthesizedAudioEmitter
4. 错误归类: 鉴权 → PermanentProviderError-like; 网络/超时 → 抛 APITimeoutError
5. close() 释放 dashscope 连接

注意:
- Qwen-TTS-Realtime 输出固定 24kHz mono 16bit (PCM_24000HZ_MONO_16BIT)
- LiveKit 默认 sample_rate 16k, 但 TTS 可以输出更高采样率 (LiveKit 内部 resample 给 RoomIO)
- DashScope SDK 同步 + callback 风格, 我们用 threading.Event 桥接到 asyncio
"""
from __future__ import annotations

import asyncio
import base64
import os
import threading
import time
from dataclasses import dataclass

from livekit.agents import APIConnectionError, APITimeoutError, tts, utils
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions

import dashscope
from dashscope.audio.qwen_tts_realtime import (
    AudioFormat,
    QwenTtsRealtime,
    QwenTtsRealtimeCallback,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
DEFAULT_MODEL = "qwen3-tts-flash-realtime"
DEFAULT_VOICE = "Cherry"
SAMPLE_RATE = 24000
NUM_CHANNELS = 1
DEFAULT_TIMEOUT_S = 30.0


@dataclass
class _TtsOptions:
    api_key: str
    endpoint: str
    model: str
    voice: str
    timeout_s: float


class QwenTtsRealtimeTTS(tts.TTS):
    """LiveKit TTS plugin wrapping Qwen-TTS-Realtime via dashscope SDK."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        endpoint: str = DEFAULT_ENDPOINT,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=SAMPLE_RATE,
            num_channels=NUM_CHANNELS,
        )
        api_key_resolved = api_key or os.environ.get("DASHSCOPE_API_KEY", "")
        if not api_key_resolved:
            raise ValueError(
                "DASHSCOPE_API_KEY not set; pass api_key= or set env var"
            )
        # Set on dashscope module level (SDK reads from there)
        dashscope.api_key = api_key_resolved
        self._opts = _TtsOptions(
            api_key=api_key_resolved,
            endpoint=endpoint,
            model=model,
            voice=voice,
            timeout_s=timeout_s,
        )

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "ChunkedStream":
        return ChunkedStream(
            tts=self,
            input_text=text,
            opts=self._opts,
            conn_options=conn_options,
        )


class ChunkedStream(tts.ChunkedStream):
    """Per-synthesize() WebSocket session to Qwen-TTS-Realtime."""

    def __init__(
        self,
        *,
        tts: QwenTtsRealtimeTTS,
        input_text: str,
        opts: _TtsOptions,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._opts = opts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        """Drive a Qwen-TTS-Realtime session for a single utterance.

        Strategy:
          1. open QwenTtsRealtime + update_session(mode='server_commit', voice, pcm 24k)
          2. append_text(self._input_text)
          3. finish() — server returns response.audio.delta stream then session.finished
          4. on each audio.delta in callback thread: queue PCM bytes
          5. main asyncio loop drains the queue and feeds output_emitter.push
        """
        loop = asyncio.get_event_loop()
        # PCM bytes queue + completion event
        pcm_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        first_audio_at: dict[str, float | None] = {"t": None}
        error_holder: dict[str, str | None] = {"err": None}

        def on_event_threadsafe(payload: dict) -> None:
            """Callback runs on dashscope SDK thread; bridge to asyncio."""
            evt = payload.get("type", "")
            if evt == "response.audio.delta":
                if first_audio_at["t"] is None:
                    first_audio_at["t"] = time.monotonic()
                pcm = base64.b64decode(payload.get("delta", ""))
                if pcm:
                    asyncio.run_coroutine_threadsafe(pcm_queue.put(pcm), loop)
            elif evt in ("response.done", "session.finished"):
                asyncio.run_coroutine_threadsafe(pcm_queue.put(None), loop)
            elif evt == "error":
                error_holder["err"] = str(payload.get("error", {}))
                asyncio.run_coroutine_threadsafe(pcm_queue.put(None), loop)

        class _Cb(QwenTtsRealtimeCallback):
            def on_open(self) -> None:
                pass

            def on_event(self, response: dict) -> None:
                on_event_threadsafe(response)

            def on_close(self, code: int, msg: str) -> None:
                # ensure consumer unblocks
                asyncio.run_coroutine_threadsafe(pcm_queue.put(None), loop)

        cb = _Cb()
        client = QwenTtsRealtime(
            model=self._opts.model, callback=cb, url=self._opts.endpoint
        )

        # Drive the SDK on a worker thread (its connect()/append_text() are blocking)
        def _drive() -> None:
            try:
                client.connect()
                client.update_session(
                    voice=self._opts.voice,
                    response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
                    mode="server_commit",
                )
                client.append_text(self._input_text)
                client.finish()
            except Exception as exc:  # noqa: BLE001
                error_holder["err"] = f"{type(exc).__name__}: {exc}"
                asyncio.run_coroutine_threadsafe(pcm_queue.put(None), loop)

        thread = threading.Thread(target=_drive, name="qwen-tts-rt-drive", daemon=True)
        thread.start()

        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=SAMPLE_RATE,
            num_channels=NUM_CHANNELS,
            mime_type="audio/pcm",
        )

        try:
            while True:
                try:
                    pcm = await asyncio.wait_for(
                        pcm_queue.get(), timeout=self._opts.timeout_s
                    )
                except asyncio.TimeoutError as exc:
                    raise APITimeoutError() from exc
                if pcm is None:
                    break  # sentinel: session done or error
                output_emitter.push(pcm)

            if error_holder["err"]:
                raise APIConnectionError(
                    f"qwen-tts-realtime error: {error_holder['err']}"
                )

            output_emitter.flush()
        finally:
            try:
                client.close()
            except Exception:
                pass
            thread.join(timeout=2.0)
