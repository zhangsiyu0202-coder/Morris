# 技术方案：多模态访谈（视觉）与结构化题目渲染

> 状态：草案（Draft）· 作者：MerismV2 工程
> 范围：`apps/agent`（LiveKit Agent Worker）+ `apps/web`（受访者端渲染）+ `packages/contracts`
> 关联：`docs/adr/0001-livekit-supervisor-interview-workflow.md`

---

## 1. 背景与目标

MerismV2 是 AI 语音访谈的定性研究平台。当前 agent 已具备：

- Supervisor + `AgentSession`（DeepSeek LLM + Qwen ASR/TTS）的语音访谈引擎；
- 按 section 走 `TaskGroup` / `AgentTask` 的问题编排；
- 通过 LiveKit **data channel / RPC** 与前端做结构化交互（选择题、评分等）；
- transcript 与结果持久化到 Appwrite。

本方案在此基础上补两块能力：

1. **结构化题目渲染**（已部分落地，需文档化并补全前端契约）：把单选/多选/评分/排序等非纯语音题，渲染成前端可点选的 UI，答案经 RPC 回传，与语音对话融合。
2. **视觉能力**（新增）：让 AI 能"看"受访者的**屏幕共享**，用于可用性测试类访谈。
3. **受访者端访谈界面**（采用 Design Interviewer Page 原型）：入场前流程（权限/屏幕共享 → 设备自检 + 同意 → 加载进房）+ 访谈房间双栏布局（左对话转录 + 自拍画面，右结构化素材），含**摄像头自拍**与**屏幕共享**。详见 §9。

### 1.1 明确的非目标（Out of Scope）

- 任何团队、协作、分享、评论、计费、订阅、配额功能（产品永久排除范围）。
- 视频录制（Egress）回放分析：属旁路存储，单独立项，不在本方案。

> **范围变更（决策已更新）**：摄像头/视频此前列为非目标，现已**纳入范围**——受访者端按原型展示自拍画面，视频/视觉能力按 §6 推进。

---

## 2. 总体原则

| 原则 | 说明 |
|---|---|
| **传输与理解分离** | LiveKit 只负责传 track。视频"能不能被理解"取决于 agent 端是否抽帧并喂给多模态模型。订阅 ≠ 理解。 |
| **双通道模型** | 「视觉理解」走 video track + 抽帧；「结构化交互」走 data channel / RPC。两条通道独立演进，互不耦合。 |
| **双模型分工** | DeepSeek 主导对话与决策；Qwen-VL 只把画面"翻译成文字"。视觉结果以文本形式回灌进 DeepSeek 上下文。 |
| **即时查询而非全量喂帧** | 默认不把每帧塞进 LLM 上下文；仅在需要判断时抓最新帧问一次视觉模型。降低 token 成本与延迟。 |
| **Consent 硬开关** | 没有视频同意标志，agent **物理上不订阅** video track，而非"订阅了但不分析"。 |
| **纯逻辑可测** | 抽帧策略、状态推进、序列化等 correctness 逻辑放在不依赖 livekit 的纯模块，便于单测。 |

---

## 3. 结构化题目渲染（Structured Rendering）

### 3.1 现状

`runtime_bridge.py` 已实现 question type → response mode 的映射：

| questionType | responseMode | 前端渲染 |
|---|---|---|
| `open_ended` / `text` / `info` | `voice_only` | 仅语音，无交互控件 |
| `single_choice` | `single_select` | 单选列表 |
| `multi_choice` | `multi_select` | 多选列表 |
| `rating` / `nps` | `scale` | 刻度/分值条 |
| `ranking` | `ranking` | 拖拽排序 |

机制：
- agent 把当前题目以 `InterviewAgentState`（含 `currentQuestion`、`responseMode`、`options`）写入 `local_participant` 的房间属性（attribute key = `INTERVIEW_STATE_ATTRIBUTE`）。
- 前端订阅该属性，按 `responseMode` 渲染对应控件。
- 用户点选后，前端通过 RPC（`SUBMIT_ANSWER_RPC_METHOD`）回传 `SubmitInterviewAnswerRpcRequest`。
- agent 在 `_handle_submit_answer` 中记录答案、推进 `question_index`、发布下一题状态，返回 `SubmitInterviewAnswerRpcResponse`（含 `nextQuestionId`、`completed`）。

### 3.2 待补全

> **状态（2026-06-14，commit `db9e94a`）**:语音引擎路径(`supervisor.py`)此前 publish `currentQuestion=None` 且工作流丢掉了 `options`/`responseMode`,导致 **live 语音访谈里结构化控件根本不渲染**(只有纯 RPC 的 `runtime_bridge` 旁路会发布)。已修复:
> - `QuestionTaskConfig` 增 `options`(TS schema + Python 镜像);`buildInterviewWorkflowConfigFromDraft` 透传 options。
> - `engine.py` 用 `index_runtime_questions(runtimeStudy)` 建 `{questionId: 完整 InterviewRuntimeQuestion}` map 传给 supervisor。
> - **每题任务 `on_enter` 把完整 `InterviewRuntimeQuestion` 发布到 `INTERVIEW_STATE_ATTRIBUTE`**(经 `build_section_task_group` 的 `on_question_enter` 回调),光标按题(而非按 section)推进 → 前端按 `responseMode` 准确渲染当前题。
> - `build_question_instructions` 对有选项的题列出 options,语音 AI 可朗读。
> 下面 **item 2 已完成**;**item 1 仅剩"答案来源融合 + e2e"**。

1. **语音 + 渲染融合**:语音引擎(`engine.py`/`supervisor.py`)与纯 RPC 的 `runtime_bridge` 仍是两条并行路径。**发布渲染状态的半边已在语音路径落地**(supervisor 每题发布 + 语音读题/读选项);**仍待补**:语音 supervisor 路径接收 `SUBMIT_ANSWER_RPC_METHOD`,把 UI 点选答案与语音答案以"先到为准"归一进同一个 `QuestionTaskResult`(`answer.source` 已区分来源)。
2. ~~**options 填充**~~ **(已完成 `db9e94a`)**:运行态 `runtimeStudy` 的选项已透传到 `QuestionTaskConfig` 并随发布与语音提示带出。
3. **前端契约**:`responseMode` 枚举与 `InterviewAgentState`(`currentQuestion`/`responseMode`/`options`)渲染字段已在 `packages/contracts` 固化,`apps/web` 据此渲染(`question-card.tsx` 消费 `state.currentQuestion`,无需改动)。

> **端到端待验(NEXT)**:supervisor `on_enter` 真发布 + 前端真渲染的完整链路需 realtime 栈 + 真语音跑一场确认(见 `interviewee-portal/tasks.md` D1)。纯逻辑(选项透传、map 索引、指令、发布查找)已单测覆盖。

### 3.3 渲染状态时序

```
agent 进入第 N 题
  │
  ├─ 发布 InterviewAgentState(status=ready, currentQuestion, responseMode, options)
  │     └─→ 前端按 responseMode 渲染控件
  ├─ 语音读题（AgentSession 朗读 questionContent）
  │
  ├─ 用户响应（二选一，先到为准）
  │     ├─ 语音作答 → 模型调用 record_answer → QuestionTaskResult
  │     └─ 点选控件 → RPC SubmitAnswer → QuestionTaskResult(source=ui)
  │
  └─ 融合层归一 → 推进 question_index → 发布第 N+1 题状态
```

---

## 4. 视觉能力：屏幕观察（Screen Observation）

### 4.1 适用场景

- **可用性测试**：受访者共享屏幕操作某产品/原型，AI 结合屏幕内容追问、判断任务完成度。
- 受访者展示文档/界面，AI 据此提问。

### 4.2 交互模式（分阶段）

| 阶段 | 模式 | 说明 |
|---|---|---|
| v1 | **被动旁观** | AI 默默看屏幕，仅当用户提问或卡顿时，抓最新帧问视觉模型，结合回答。打通链路。 |
| v2 | **主动引导** | AI 下达任务（"试着完成下单"），盯屏判断是否完成/卡点，主动追问，并把判断**反馈进 supervisor 状态机**驱动推进。 |

### 4.3 数据流

```
受访者共享屏幕
  │  (LiveKit screen_share video track, source=SCREEN_SHARE)
  ▼
VideoFrameSampler  ── 帧差检测：屏幕静止不抽帧，变化时才抽
  │  (产出"最新帧"缓存，事件驱动)
  ▼
触发条件命中（用户提问 / 卡顿 / 主动引导判定点）
  │
  ├─→ build_vision_llm (Qwen-VL)：最新帧 + 简短 prompt → 文字描述
  │        例："用户当前在结算页，未找到优惠码输入框"
  ▼
文字描述回灌进 DeepSeek 对话上下文
  │
  ▼
DeepSeek 生成下一句话 / supervisor 决策是否推进
```

### 4.4 抽帧策略（成本关键）

屏幕画面大部分时间静止，因此采用**帧差驱动**而非固定帧率：

- 计算相邻帧差异（如缩略图哈希 / 像素差阈值），低于阈值不更新"最新帧"。
- 仅维护**单张最新帧**缓存，不累积历史帧。
- 真正的 vision 推理仅在**触发条件命中**时发生（按需查询），不是每帧都推理。
- 触发条件：用户语音提问、VAD 静默超阈值（疑似卡顿）、主动引导判定点、模型显式请求"看一下"。

预期成本：屏幕场景下，一次访谈的 vision 调用次数为个位数到几十次量级，远低于按帧推理。

### 4.5 与现有 provider 抽象的衔接

`agent/providers/` 已是可插拔结构（`build_llm` / `build_stt` / `build_tts`，含后端注册表）。视觉沿用同一模式：

- 新增 `build_vision_llm(settings)`：默认走 Qwen-VL（DashScope OpenAI 兼容端点，与现有 Qwen 语音同 key 体系），可插拔后续替换。
- 视觉是**独立 extra**，懒加载，不影响 foundation 测试速度。

### 4.6 Consent 硬开关

- runtime study / room metadata 增加视频同意标志（如 `videoConsent: boolean`）。
- agent 启动时：无同意 → **不注册 video track 订阅回调**，`VideoFrameSampler` 不实例化。
- 前端：无同意 → 不显示"共享屏幕"入口。
- 同意是**双端硬约束**，不是运行时软过滤。

---

## 5. 组件清单与落点

| 组件 | 位置 | 是否纯逻辑可测 | 说明 |
|---|---|---|---|
| `responseMode` 枚举 + 渲染字段 | `packages/contracts` | ✅ | 前后端共享契约 |
| 答案来源融合层 | `apps/agent/agent/interview/` | ✅ | RPC 答案与语音答案归一 |
| options 填充修正 | `runtime_bridge.py` | ✅ | 从 runtimeStudy 带出选项 |
| `VideoFrameSampler` | `apps/agent/agent/interview/` | ✅（抽帧/帧差逻辑） | 订阅 video track，帧差驱动，维护最新帧 |
| `build_vision_llm`（Qwen-VL） | `apps/agent/agent/providers/` | 配置解析可测 | 沿用可插拔后端 |
| supervisor 视觉接入 | `supervisor.py` | 部分 | 触发点抓帧→查询→回灌上下文/决策 |
| consent 开关 | metadata / runtime study + 两端 | ✅ | 硬约束 |
| 前端渲染控件 + 屏幕共享入口 | `apps/web` | — | 按 responseMode 渲染；consent 控制入口 |

---

## 6. 摄像头/视频能力（纳入范围）

**决策更新**：摄像头/视频纳入范围。受访者端按原型在房间内展示**自拍画面**（见 §9），并随访谈采集视频 track。

分阶段推进，避免一次性堆复杂度：

| 阶段 | 能力 | 说明 |
|---|---|---|
| v1 | **自拍画面 + 视频 track** | 受访者端展示本地摄像头预览；LiveKit 发布 video track（camera source）。consent 控制是否采集。 |
| v2 | **视频抽帧 → 视觉模型** | 沿用 §4 的帧差驱动 + 按需查询模式，把画面"翻译成文字"回灌 DeepSeek 上下文。 |

### 6.1 配套：基于语音韵律的客观信号

视频能力之外，仍产出**客观事件标记**作为研究者复盘的补充（与视频并行，不互斥）：

- "第 3 题回答时停顿 8 秒"
- "回答某题时语速明显变慢"
- "出现多次犹豫词"

这些由音频 / VAD 直接获得，安全且提升报告质量。具体实现单独立项。

### 6.2 注意事项

- **情绪/表情判断需谨慎**：通用多模态模型对单帧静态图判断"情绪"可靠性有限，表情→情绪映射有争议。若做，应产出**可核查的观察描述**而非武断的情绪结论，避免给研究者制造虚假精确感。
- **合规**：面部数据在多地区按敏感数据监管，consent 为硬开关（见 §4.6），无同意则不采集 video track。

---

## 7. 风险与权衡

| 风险 | 缓解 |
|---|---|
| Qwen-VL 视觉延迟拖慢对话 | 按需查询 + 单帧；触发点控制频率；查询期间用 filler 话术 |
| 屏幕共享含敏感信息 | consent 前置；最新帧不落盘（除非走独立录制方案并另行同意） |
| 双通道答案竞争（语音 vs 点选） | 融合层以"先到为准 + 去重"，`answer.source` 记录来源 |
| DashScope 语音/视觉 OpenAI 兼容度 | provider 可插拔，保留切换原生 SDK 的余地 |

---

## 8. 分阶段交付建议

1. **结构化渲染补全**：options 填充 + 答案融合层 + contracts 固化（不依赖视觉，价值独立）。
2. **视觉基础层**：`VideoFrameSampler`（纯抽帧逻辑 + 单测）+ `build_vision_llm` provider 抽象 + consent 开关。
3. **屏幕观察 v1（被动旁观）**：触发点抓帧 → Qwen-VL → 回灌 DeepSeek 上下文。
4. **屏幕观察 v2（主动引导）**：视觉判断反馈进 supervisor 状态机。
5. **摄像头/视频**：v1 自拍画面 + video track 发布；v2 视频抽帧 → 视觉模型（§6）。
6. **语音韵律信号**（视频之外的补充）：独立立项。

---

## 9. 受访者端 UI（采用 Design Interviewer Page 原型）

受访者端界面以 **Design Interviewer Page** 原型为基准实现，落点为 `apps/web` 的访谈页（`/interview`）。原型为 Figma Make 导出的 Vite/React 稿，移植时按下述对照接入项目既有能力，不照搬其依赖（MUI/emotion 等不引入）。

### 9.1 入场前流程（PreInterviewFlow）

三段式，进房前完成权限与同意：

1. **权限 / 屏幕共享**：请求共享屏幕（可用性测试场景），consent 硬开关控制是否展示该入口（§4.6）。
2. **设备自检 + 同意**：预览屏幕共享画面 + 浮动摄像头自拍，麦克风/屏幕源选择，勾选"确认共享并同意被录制"后方可开始。
3. **加载进房**：进度动画，完成后接入 LiveKit 房间。

### 9.2 访谈房间布局（InterviewSession）

双栏外壳：

- **顶栏**：品牌 + 计时 + 进度条。
- **左栏（固定宽）**：上 2/3 为**对话转录**（AI 消息流 + 输入指示），下 1/3 为**受访者自拍画面**（摄像头预览 + 说话音浪 + 静音标识）。
- **右栏**：**结构化素材 / 概念**展示区，复用既有 `StimulusDisplay`（image/video/text + 放大）与结构化题控件（§3）。
- **底栏**：麦克风/摄像头开关 + 作答 CTA + 跳过。

### 9.3 移植对照（原型 → 项目）

| 原型部分 | 项目落点 |
|---|---|
| `PreInterviewFlow`（权限/自检/加载） | `apps/web` 访谈页进房前阶段（interviewee-portal） |
| `CandidatePage` 双栏房间外壳 | `components/interview/` 房间外壳 |
| 右栏写死的概念素材 | 既有 `StimulusDisplay`（contract 驱动） |
| mock 的 AI 消息流 | LiveKit transcription / 房间属性 |
| 自拍画面 | LiveKit camera video track（§6） |
| 屏幕共享 | LiveKit screen_share track（§4，consent 门控） |
| 按键录音 mock | 既有连续语音 + 结构化作答融合（§3） |

> 视觉风格与设计令牌以 `.kiro/steering/design-system.md` 为准，移植时把原型配色映射到项目令牌。
