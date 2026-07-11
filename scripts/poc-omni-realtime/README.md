# poc-omni-realtime

Throw-away PoC: 验证 **Qwen-Omni-Realtime + Qwen-TTS-Realtime hybrid** 在 LiveKit 上的可行性, 为 ADR-0010 (替换 Gemini Live → Qwen-Omni hybrid 实时访谈链路) 提供事实依据.

加到 `.gitignore` (`scripts/poc-*/`), 不入主仓 git.

## 架构

```
受访者麦克风 → LiveKit → Agent
                         ├─ Qwen-Omni-Realtime (modalities=["text"])  ← ASR+LLM, 仅文本输出
                         └─ QwenTtsRealtimeTTS (本目录 thin adapter)  ← 独立 TTS, 24kHz PCM
                         ↓
                       LiveKit → 受访者扬声器
```

## 文件

| 文件 | 用途 | 谁跑 |
|---|---|---|
| `verify_qwen_tts_realtime.py` | P1 Qwen-TTS-Realtime API 协议验证 | agent (已跑) |
| `verify_qwen_omni_realtime.py` | P2 Qwen-Omni-Realtime API 协议验证 | agent (已跑) |
| `qwen_tts_realtime_tts.py` | thin LiveKit TTS adapter (~220 行) | 库, 不直跑 |
| `verify_tts_adapter_standalone.py` | adapter 独立验证 (不经 AgentSession) | agent (已跑) |
| `poc.py` | LiveKit AgentSession 端到端集成主脚本 | **你** (需麦克风) |
| `RESULTS.md` | 实测数据 + ADR-0010 quirks 清单 | agent 维护 |

## 环境准备

项目根 `.env` 已有: `DASHSCOPE_API_KEY` / `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. PoC 用独立 venv 不污染主仓.

```bash
cd scripts/poc-omni-realtime
uv venv --python 3.12
source .venv/bin/activate
uv pip install dashscope python-dotenv numpy "livekit-agents[openai]~=1.6" livekit-plugins-silero
```

## Phase 0a: API 验证 (已跑过)

```bash
.venv/bin/python verify_qwen_tts_realtime.py    # P1
.venv/bin/python verify_qwen_omni_realtime.py   # P2 (吃 P1 的 wav)
.venv/bin/python verify_tts_adapter_standalone.py  # P3.5
```

三个 PASS = 协议 + hybrid + adapter 实现都没问题. 见 `RESULTS.md`.

## Phase 0b: LiveKit 端到端 (你跑)

**console 模式 (推荐, 本机麦克风+扬声器, 不用起 LiveKit server)**:

```bash
.venv/bin/python poc.py console
```

**预期**: 启动后说"你好你是谁", 听到回应包含"我是小绿". 端到端延迟 < 2s.

**dev 模式 (worker, 模拟生产)**:

```bash
.venv/bin/python poc.py dev
```

之后用 [LiveKit Agents Playground](https://agents-playground.livekit.io/) 加房间测试.

## 失败排查

| 现象 | 原因 |
|---|---|
| `Voice 'null' is not supported` | Qwen-Omni quirk, poc.py 已加占位 voice="Ethan" 应不会再现 |
| 没声音 | adapter standalone 测试若 PASS 说明 TTS 链路 OK, 检查麦克风/扬声器权限 |
| 高延迟 (>3s) | Omni 推理 ~370ms + TTS 首包 ~328ms 是正常; 超过 3s 查网络到北京 dashscope |

## 后续

PoC 通 → 起 `docs/adr/0010-omni-realtime-hybrid.md` + sub-spec `agent-omni-realtime`. 不动 ADR-0004/0005 视频分析.
