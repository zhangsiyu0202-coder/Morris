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

### 1.1 明确的非目标（Out of Scope）

- **摄像头表情/情绪分析**：经评估，**本期不做**。理由见 §6。
- 任何团队、协作、分享、评论、计费、订阅、配额功能（产品永久排除范围）。
- 视频录制（Egress）回放分析：属旁路存储，单独立项，不在本方案。

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

1. **语音 + 渲染融合**：当前 `runtime_bridge` 是纯 RPC 驱动（前端提交即推进），与语音引擎（`engine.py` / `supervisor.py`）是两条并行路径。需要统一：
   - 对 `voice_only` 题：走语音 `AgentTask`，由模型 `record_answer` 完成。
   - 对结构化题（`single_select` 等）：agent 用语音读题 + 引导（"你可以直接在屏幕上选择"），**同时**发布渲染状态；答案以 RPC 或语音二者**先到为准**。
   - 需要一个"答案来源融合"层，把 RPC 答案与语音答案归一成同一个 `QuestionTaskResult`（`answer.source` 已区分来源）。
2. **options 填充**：`_questions_from_section` 目前 `options=[]`，需要从 study 定义把选项带出来（运行态 `runtimeStudy` 已含完整题目，应优先用它）。
3. **前端契约**：在 `packages/contracts` 固化 `responseMode` 枚举与 `InterviewAgentState` 渲染所需字段，`apps/web` 据此渲染。

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

## 6. 关于摄像头表情分析的决策（本期不做）

经评估，**砍掉摄像头表情/情绪分析**，把"深层洞察"放到**语音韵律信号**上做。理由：

1. **准确性存疑**：通用多模态模型对单帧静态图判断"情绪"可靠性低；表情→情绪映射本身有争议（皱眉可能是困惑/思考/不适）。输出"情绪报告"会给研究者制造**虚假的精确感**，污染定性结论。
2. **本质是视频流时序分析**：表情是连续动态的，单帧抽样丢失停顿、迟疑、视线回避等时间维度信息。做好需专门的 affect 模型 + 时序分析，是另一套技术栈。
3. **合规风险**：匿名受访者的面部情绪分析涉及生物特征数据（多地区按敏感数据监管），与产品"匿名、轻量"定位冲突。
4. **大量信号在语音侧已可得**：停顿时长、语速变化、犹豫词等可由音频 / VAD 直接获得，**无需摄像头**。

### 6.1 替代方案：基于语音韵律的客观信号

产出**客观事件标记**而非情绪结论，把判断权留给研究者：

- "第 3 题回答时停顿 8 秒"
- "回答某题时语速明显变慢"
- "出现多次犹豫词"

这些作为研究者复盘时的标记，安全且真正提升报告质量。具体实现单独立项。

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
5. **语音韵律信号**（替代表情方案）：独立立项。
