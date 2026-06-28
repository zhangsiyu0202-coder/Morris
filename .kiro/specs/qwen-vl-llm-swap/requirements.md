# Qwen-VL LLM Swap — Requirements

## Introduction

实时访谈 agent（`apps/agent`）的 cascade LLM 从 **DeepSeek（纯文本）换成
Qwen-VL（多模态）**，使 agent 能消费每道题随附的 image stimulus，在视觉
类问题上"看着图"追问而不是盲问。同时修复 `workflow.py` 把 `stimulus`
硬编码为 `None` 的缺陷，让 stimulus 从 runtime study 一路传到
`QuestionTaskConfig`。STT/TTS 仍为 Qwen；Gemini Live 模式（ADR-0007）的
LLM/ASR/TTS 仍由 Live 模型自己承担。

本次顺带解除一个历史残留耦合：旧 `resolve_provider_settings` 无条件先
解析 Qwen speech，导致 Gemini Live 模式也强制要求 Qwen key——而该模式
下 Qwen TTS 从未被 `engine.py` 装配。**决策：Gemini 模式去除 Qwen TTS
依赖**（`speech=None`，不消费 Qwen key）。

架构影响：Qwen 占据 LLM 槽位，违反 `architecture.md` "DeepSeek is the
only LLM" 规则，待 ADR-0011 反映；DeepSeek adapter 保留为 dormant 以便
回退，不在本 spec 删除。

## Glossary

- **Cascade LLM**：非 Gemini 模式下 `AgentSession(llm=...)` 槽位使用的
  对话/归纳 LLM。
- **Stimulus**：题目随附的刺激物，`type ∈ {text, image, video}`
  （`contracts.py::Stimulus`）。
- **DashScope OpenAI-compat**：阿里百炼的 OpenAI 兼容网关，一把
  `DASHSCOPE_API_KEY` 同时覆盖 Qwen-VL LLM 与 Qwen ASR/TTS。
- **Default cascade mode**：`MERISM_GEMINI_LIVE` 未设为 `"1"` 的默认模式。
- **Gemini Live mode**：`MERISM_GEMINI_LIVE="1"`（ADR-0007）。

## Requirements

### Requirement 1: Cascade LLM 解析为 Qwen-VL

**User Story:** 作为运维者，我希望默认 cascade LLM 是 Qwen-VL 并复用
DashScope key，这样 agent 无需额外 LLM provider 即可获得多模态能力。

#### Acceptance Criteria

1. WHEN `resolve_llm_settings` 接收含 `DASHSCOPE_API_KEY` 的 env，THE
   system SHALL 返回 `LLMSettings`，其 `api_key` 取该值、`base_url` 为
   `DEFAULT_QWEN_BASE_URL`、`model` 为 `DEFAULT_QWEN_VL_MODEL`
   （`qwen3-vl-plus`）。
2. WHERE env 同时缺 `QWEN_API_KEY` 与 `DASHSCOPE_API_KEY`，WHEN 调用
   `resolve_llm_settings`，THE system SHALL 抛出 `ProviderConfigError`。
3. WHEN env 提供 `QWEN_API_KEY`，THE system SHALL 接受其作为
   `DASHSCOPE_API_KEY` 的别名解析 LLM key。
4. WHEN env 提供 `QWEN_VL_MODEL`，THE system SHALL 用其覆盖默认 model
   而无需改动代码。
5. THE DeepSeek 常量（`DEFAULT_DEEPSEEK_BASE_URL` /
   `DEFAULT_DEEPSEEK_MODEL`）SHALL 保留在 `settings.py` 但不被
   `resolve_llm_settings` 读取。

### Requirement 2: Qwen-VL 适配器构造

**User Story:** 作为 agent，我希望通过窄接口拿到一个绑定 Qwen-VL 的
livekit LLM 实例，这样调用点无需感知 provider 细节。

#### Acceptance Criteria

1. WHEN 调用 `qwen_llm.build_llm(settings)`，THE system SHALL 返回一个
   `livekit.plugins.openai.LLM`，其 `model`/`api_key`/`base_url` 取自
   传入的 `LLMSettings`。
2. THE `qwen_llm` 模块顶层 SHALL NOT import `livekit.plugins`；该 import
   SHALL 延迟到 `build_llm` 函数体内，使模块在无 `realtime` extra 时仍
   可 import。
3. THE `agent.providers` 包 SHALL 从 `qwen_llm` re-export `build_llm`，
   且 SHALL NOT 再导出任何 `qwen_vl_*` 旧符号。

### Requirement 3: Stimulus 透传至 QuestionTaskConfig

**User Story:** 作为研究员，我希望我在题目上配置的 stimulus 能真正到达
agent，这样视觉/文本刺激物不会在装配时被丢弃。

#### Acceptance Criteria

1. WHEN `_section_config_from_runtime` 处理一个带 `stimulus` 的
   `InterviewRuntimeQuestion`，THE system SHALL 将该 `stimulus` 原样写入
   对应 `QuestionTaskConfig.stimulus`（此前硬编码为 `None`）。
2. WHERE runtime question 的 `stimulus` 为 `None`，THE
   `QuestionTaskConfig.stimulus` SHALL 为 `None`。
3. THE 透传 SHALL 保持 `stimulus` 的 `type`/`url`/`text`/`durationMs`
   字段不变。

### Requirement 4: 按 stimulus 类型生成题目指令

**User Story:** 作为 agent，我希望题目指令根据 stimulus 类型给出不同
引导，这样我对文本、图片、视频刺激物采取正确的追问策略。

#### Acceptance Criteria

1. WHEN `build_question_instructions` 处理 `type == "text"` 且 `text`
   非空的 stimulus，THE system SHALL 在指令中内联该文本内容，并包含
   "Reference it directly" 引导语。
2. WHEN 处理 `type == "image"` 的 stimulus，THE system SHALL 在指令中
   标注 `(image)` 并使用"attached frame"语义，告知模型按所见图像追问。
3. WHEN 处理 `type == "video"` 的 stimulus，THE system SHALL 在指令中
   标注 `(video)` 并明确该帧"not attached"，告知模型等受访者反应后再
   追问。
4. WHERE `stimulus` 为 `None`，THE 题目指令 SHALL NOT 含任何 stimulus
   相关段落。

### Requirement 5: 图像注入到 chat context

**User Story:** 作为多模态 agent，我希望在进入图片题时把图像加入
chat context，这样 Qwen-VL 能看到受访者正在看的内容。

#### Acceptance Criteria

1. WHEN `LiveKitQuestionTask.on_enter` 执行且当前 question 的 stimulus
   `type == "image"` 且 `url` 非空，THE system SHALL 向 `chat_ctx`
   追加一条 `role="user"` 消息，内容包含一段标注其为"stage context /
   NOT respondent speech"的文字与一个 `ImageContent(image=stim.url)`。
2. WHERE stimulus 为 `None`、或 `type != "image"`、或 `url` 为空，THE
   system SHALL NOT 注入任何图像内容。
3. THE 图像注入路径 SHALL NOT 处理 `video` 类型（视频抽帧不在本 spec
   范围）。
4. THE `ImageContent` 的 import SHALL 延迟到注入方法体内，保持模块在无
   `realtime` extra 时可 import。

### Requirement 6: Gemini 模式解除 Qwen speech 依赖

**User Story:** 作为运维者，我希望 Gemini Live 模式不再强制要求 Qwen
key，这样我只配 Gemini key 即可启用该模式。

#### Acceptance Criteria

1. WHEN `MERISM_GEMINI_LIVE == "1"` 且 env 含 Gemini key，WHEN 调用
   `resolve_provider_settings`，THE system SHALL 返回 `llm=None`、
   `speech=None`、`gemini` 为已解析的 `GeminiSettings`。
2. WHILE 处于 Gemini Live 模式，THE `resolve_provider_settings` SHALL
   NOT 调用 `resolve_speech_settings`，亦 SHALL NOT 因缺 Qwen key 而失败。
3. WHEN `MERISM_GEMINI_LIVE == "1"` 但缺 Gemini key，THE
   `provider_settings_available` SHALL 返回 `False`。
4. THE `ProviderSettings.speech` 字段类型标注 SHALL 为
   `SpeechSettings | None`，与运行时 Gemini 模式 `speech=None` 一致。
5. WHEN 处于 default cascade 模式且 env 含 DashScope key，THE
   `resolve_provider_settings` SHALL 返回 `llm`、`speech` 均非 `None`、
   `gemini=None`。

### Requirement 7: engine 默认分支类型收窄守卫

**User Story:** 作为维护者，我希望 cascade 分支在使用 `llm`/`speech`
前显式断言其非 `None`，这样上游回归会产生清晰的 AssertionError 而非
混淆的 AttributeError。

#### Acceptance Criteria

1. WHEN `InterviewEngine._build_session` 进入 default cascade 分支（即
   `self._settings.gemini is None`）之后、构造 `AgentSession` 之前，THE
   system SHALL 断言 `self._settings.llm is not None` 与
   `self._settings.speech is not None`。
2. WHEN cascade 分支构造 `AgentSession`，THE `llm=` 槽位 SHALL 由
   `qwen_llm.build_llm` 提供。
3. THE Gemini 分支 SHALL 保持仅装配 `llm=build_realtime_llm(...)`、不装配
   Qwen STT/TTS，行为不变。

### Requirement 8: 测试与回归

**User Story:** 作为维护者，我希望本次改动随附完整的单元+属性测试，这样
契约不靠后续 PR 兜底。

#### Acceptance Criteria

1. THE `tests/test_providers.py` SHALL 断言 default 模式 LLM 为
   Qwen-VL（`model == DEFAULT_QWEN_VL_MODEL`，key 来自 DashScope），且
   Gemini 模式 `llm is None` 且 `speech is None`。
2. THE `tests/test_providers.py::test_provider_settings_available_per_mode`
   SHALL 断言：default 模式仅需 DashScope key；Gemini 模式仅需 Gemini
   key（不要求 Qwen key）；Gemini 模式缺 Gemini key 时不可用。
3. THE `tests/test_workflow.py` SHALL 新增覆盖：stimulus 透传到
   `QuestionTaskConfig`、text 类型内联、image 类型 `(image)`+
   "attached frame"、video 类型 `(video)`+"not attached"。
4. THE `pnpm test:py` SHALL 在无 `--extra realtime` 的情况下全绿。
5. WHERE 需要验证 `ImageContent(image=url)` URL 构造，THE 验证 SHALL
   作为可选 live/手动 smoke，SHALL NOT 阻塞 CI 单元测试。
