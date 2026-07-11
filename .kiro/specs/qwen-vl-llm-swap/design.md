# Qwen-VL LLM Swap — Design

## 数据流（provider 替换 + stimulus 透传，控制流不变）

```
runtime study (InterviewRuntimeQuestion.stimulus)
        │  workflow.py::_section_config_from_runtime
        ▼  stimulus=question.stimulus   ← 修复点（原 None）
QuestionTaskConfig.stimulus
        │
        ├─► tasks/question.py::build_question_instructions
        │       per-type 文案分支（text 内联 / image attached-frame / video not-attached）
        │
        └─► tasks/question.py::LiveKitQuestionTask.on_enter
                └─ _maybe_inject_visual_stimulus（image-only）
                       chat_ctx.add_message(role=user, [label, ImageContent(url)])
                       ▼
engine.py::_build_session (default cascade)
   assert llm/speech not None
   AgentSession(stt=Qwen, tts=Qwen, llm=qwen_llm.build_llm(...), vad, turn_detection)
        ▼
   livekit openai plugin → DashScope OpenAI-compat → Qwen-VL（image_url content）
```

Gemini 分支（`MERISM_GEMINI_LIVE=1`）：`AgentSession(llm=build_realtime_llm(gemini))`，
无 Qwen STT/TTS，`speech=None`。

## 模块改动清单

| 文件 | 改动 | 关键不变量 |
|---|---|---|
| `providers/qwen_llm.py`（新）| `build_llm(LLMSettings) -> openai.LLM`，DashScope base_url | 顶层不 import livekit；lazy import |
| `providers/settings.py` | `resolve_llm_settings` 解析 Qwen-VL；`ProviderSettings.speech: SpeechSettings \| None`；`resolve_provider_settings` 把 `resolve_speech_settings` 挪进 cascade 分支，Gemini 分支 `speech=None`；DeepSeek 常量保留 dormant | 纯函数、无 SDK import |
| `providers/__init__.py` | re-export `build_llm` 来自 `qwen_llm`；移除 `qwen_vl_*` 符号 | — |
| `interview/workflow.py` | `_section_config_from_runtime` 传 `stimulus=question.stimulus` | 纯函数、side-effect free |
| `interview/tasks/question.py` | `build_question_instructions` per-type 分支；`_maybe_inject_visual_stimulus`（image-only，role=user，stage-context label）；`ImageContent` lazy import | 第一写入者获胜逻辑不变 |
| `interview/engine.py` | import 改 `qwen_llm.build_llm`；cascade 分支前加 `assert llm/speech not None`；注释更新提 Qwen-VL | Gemini 分支行为不变 |
| `tests/test_providers.py` | 重写为 Qwen-VL 默认；Gemini 模式断言 `speech is None`、仅需 Gemini key | 无 livekit import |
| `tests/test_workflow.py` | 新增 stimulus 透传 + per-type 指令 4 个用例 | — |

## §6 决策记录（已定）

采用 **(A) 解耦**：Gemini Live 模式下 `speech=None`、不消费 Qwen key。
理由：`engine.py` 的 Gemini 分支从不装配 Qwen TTS（Gemini Live 自出
音频），旧代码无条件解析 Qwen speech 属 vestigial coupling。`ProviderSettings.speech`
类型同步放宽为 `SpeechSettings | None` 以与运行时一致。

## settings.py 目标形态（关键片段）

```python
@dataclass(frozen=True)
class ProviderSettings:
    # cascade LLM (Qwen-VL); None in Gemini Live mode.
    llm: LLMSettings | None
    # Qwen ASR/TTS; None in Gemini Live mode (Live emits audio itself).
    speech: SpeechSettings | None
    gemini: GeminiSettings | None = None


def resolve_provider_settings(env=None) -> ProviderSettings:
    resolved = os.environ if env is None else env
    if gemini_live_enabled(resolved):
        return ProviderSettings(
            llm=None, speech=None, gemini=resolve_gemini_settings(resolved)
        )
    return ProviderSettings(
        llm=resolve_llm_settings(resolved),
        speech=resolve_speech_settings(resolved),
        gemini=None,
    )
```

## engine.py cascade 分支目标形态（关键片段）

```python
if self._settings.gemini is not None:
    from agent.providers.gemini import build_realtime_llm
    return AgentSession(llm=build_realtime_llm(self._settings.gemini))

# Default cascade invariant: when gemini is None, both llm and speech
# are non-None (resolve_provider_settings). Asserts narrow the types for
# the builders and turn an upstream regression into a clear AssertionError.
assert self._settings.llm is not None, "cascade mode requires LLM settings"
assert self._settings.speech is not None, "cascade mode requires speech settings"

tts = build_tts(self._settings.speech)
vad = self._vad or silero.VAD.load()
return AgentSession(
    stt=build_stt(self._settings.speech),
    tts=tts,
    llm=build_llm(self._settings.llm),
    vad=vad,
    turn_detection=self._build_turn_detection(),
)
```

## 测试设计

### 单元（test_providers.py，无 realtime extra）

- `resolve_llm_settings`：DashScope 默认、QWEN_API_KEY 别名、QWEN_VL_MODEL
  覆盖、缺 key 抛错。
- default 模式：`llm.model == DEFAULT_QWEN_VL_MODEL`、`llm.api_key`/
  `speech.api_key` 同源、`gemini is None`。
- Gemini 模式：`llm is None`、`speech is None`、`gemini.api_key` 来自
  Gemini key。env **不含** Qwen key 仍成功。
- `provider_settings_available`：default 仅需 DashScope；Gemini 仅需
  Gemini key；Gemini 缺 Gemini key → False。

### 单元（test_workflow.py）

- stimulus 透传：构造带 `Stimulus(type="text", text=...)` 的 runtime
  question，断言 `_section_config_from_runtime(...).questions[0].stimulus`
  非 None 且字段一致。
- `build_question_instructions`：
  - text → 含 stimulus 文本 + "Reference it directly"
  - image → 含 `(image)` + "attached frame"
  - video → 含 `(video)` + "not attached"（或等价"react in their own words"）

### 不做单元测试（记录理由）

- `_maybe_inject_visual_stimulus` 运行时路径：需构造
  `LiveKitQuestionTask`（依赖 realtime extra + live chat_ctx 的
  `update_chat_ctx`），超出 Layer-1。以可选手动 smoke 验证
  `ImageContent(image="https://...")` 构造。

## 与现有 spec / ADR 关系

| 参考 | 关系 |
|---|---|
| `architecture.md` "DeepSeek is the only LLM" | 本次违反，待 ADR-0011（TODO）反映；DeepSeek adapter 保留 dormant 便于回退 |
| ADR-0007 (Gemini Live) | 不冲突；本 spec 仅解除其对 Qwen speech 的残留依赖，Gemini Live config 不变 |
| `errors-and-observability.md` provider adapter 规则 | qwen_llm 适配器遵循窄接口；第二 LLM provider 的 ADR 缺口由 ADR-0011 兜 |

## 已知 trade-off / 范围外

- video stimulus 不抽帧注入（`ImageContent` 不承载 video，需不同
  content shape）→ defer。
- 不删除 `providers/deepseek.py`（dormant 保留便于回退）。
- 不重命名 `LLMSettings`（形状足够通用）。
- 不改 `apps/agent/agent/contracts.py`（stimulus 模型已存在）。
- ADR-0011 与 steering（architecture.md / AGENTS.md "DeepSeek-only"
  规则）的更新为独立文档交付，本 spec 不含。
