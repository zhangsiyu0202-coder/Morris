# Requirements — ai-interview-engine

> 前置:ADR-0001(LiveKit Supervisor / TaskGroup / AgentTask 访谈控制器)、`foundation-setup/design.md`(契约 + room metadata)、`apps/agent/AGENTS.md`、`.kiro/steering/{architecture,errors-and-observability,testing,scope}.md`。

本 Spec **追认并治理** 已落地的实时语音访谈引擎(`apps/agent`),把"实现 + 测试在位但无规格"变成"有契约、有边界、可回归"。**纯治理,无新增字段/形态**;并显式钉死若干 non-goal(下面 §4),防止后来者重新发明。

## 1. 既有实现清单(治理对象)

| 区域 | 文件 | 职责 |
|---|---|---|
| 纯工作流 | `agent/interview/workflow.py` | 无 I/O:由 room metadata 派生 `InterviewWorkflowConfig`、推进 `InterviewWorkflowState`、投影 `QuestionTaskResult`。correctness 全在这里,可单测/属性测。 |
| Supervisor | `agent/interview/supervisor.py` | 长生命周期 `InterviewSupervisorAgent`(livekit 懒导入):问候 → 逐 section 走 TaskGroup(每题一个 AgentTask)→ 记录结果 → 发布 `InterviewAgentState` → 流式落 Appwrite。`super().__init__(instructions=state.workflowConfig.supervisorInstruction)`。 |
| 引擎 | `agent/interview/engine.py` | 驱动 livekit,委托所有状态迁移给 workflow.py;`workflow_config_from_metadata`。 |
| TaskGroup/任务 | `agent/interview/{task_group_builder,tasks/question}.py` | 构建分节 TaskGroup;单题采集 + 追问(每题至少 1 轮,深度由 `maxRounds` 控)。 |
| 转写/录制 | `agent/interview/{transcript,egress_recorder}.py` | 转写聚合;egress 录制。 |
| 持久化 | `agent/persistence/{appwrite_repository,serializers}.py` | finalized artifact 单向落 Appwrite(纯序列化 + repo)。 |
| Provider | `agent/providers/{deepseek,qwen,settings}.py` | DeepSeek=LLM,Qwen=ASR/TTS,窄接口。 |
| 契约镜像 | `agent/contracts.py` | pydantic 镜像 `packages/contracts` 中 agent 需要的子集(字段名 camelCase 对齐)。 |

## 2. 功能需求(验收基线)

- **R1 控制器形态**:整场访谈 = LiveKit Supervisor + 有序 TaskGroup(每 section 一个)+ 聚焦 AgentTask(每题一个)。无 LangGraph、无自定义状态机、无第二控制框架(ADR-0001)。
- **R2 纯状态**:所有 correctness 迁移(派生 config、advance、record result、完成判定)在 `workflow.py`,无副作用,单测/属性可测;`engine.py`/`supervisor.py` 只做 I/O 并委托。
- **R3 消费主持指令**:Supervisor 的 `instructions` 即 `InterviewWorkflowConfig.supervisorInstruction`——该串由 `buildInterviewWorkflowConfigFromDraft` 合成(研究员的 `Survey.moderatorInstruction` persona 前置 + 操作性默认)。问题来自同一 `workflowConfig.sections[].questions[]`。两者同包(room metadata)到达。
- **R4 追问**:每题至少 1 轮追问;深度 `standard`/`deep` 经 `ProbeConfig.maxRounds`(默认 3/5)控制,AI 可提前停。
- **R5 realtime↔persistence 边界**:turn-by-turn 状态 / 部分转写 / "下一题"游标留在房间(room metadata + participant attribute + RPC);仅 finalized artifact(完整转写、录音、`collectedAnswers`)单向 append 落 Appwrite。绝不把"下一题"经 Appwrite 往返。
- **R6 provider 适配**:DeepSeek 唯一 LLM,Qwen 唯一 ASR/TTS,各在窄接口后;瞬时/永久失败分类经 `with_retry`。
- **R7 可观测**:`create_logger(scope)` 每会话一个 traceId;不在 info 级打印原始 prompt/转写/音频;不泄漏密钥。
- **R8 opt-in realtime**:`agent/interview/*` 的 livekit 导入保持懒加载,`pnpm test:py`(无 `--extra realtime`)可跑。

## 3. 既有测试(纳入基线)

`apps/agent/tests/`:`test_workflow.py`(状态迁移)、`test_contracts.py`(镜像往返)、`test_transcript_persistence.py`、`test_recording_persistence.py`、`test_providers.py`。本 Spec 不新增单测(无新代码)。

## 4. 非目标(显式钉死,防重新发明)

- **无声明式 skip logic**(产品决策):不做"按回答跳转/跳题"的声明式分支;**访谈覆盖度由 Supervisor 在对话中动态判断收集**。`QuestionBlock.skipLogic` 是历史死桶(恒 `{}`),本引擎不消费它。
- **无整场访谈分类字段**:不新增 PostHog `user_interviews.classifications`(abandoned/off-topic)那种字段——Merism 既有 `SessionState`(含 `abandoned`)+ `SessionQualityFlag`(含 `off-topic`/`silent`/`refused-topic` 等)已覆盖该用途(`scope.md`"优化既有 artifact 不分叉")。
- **不借 Vapi/webhook 那套**:PostHog 用第三方 Vapi 跑语音故有 25KB webhook;Merism 自建 LiveKit agent,架构不同且更可控,不引入 webhook 编排。
- **无第二 LLM / 第二 ASR-TTS provider**(需 ADR);**无 LangGraph**;**不把 turn 状态落 Appwrite**。

## 5. 缺口标注(收口债)

- **缺 live 语音端到端验证**:无"真 LiveKit + 真/假 provider"跑通一整场语音访谈的端到端测试。需 `pnpm stack:up` + `uv sync --extra realtime` + `MERISM_FAKE_PROVIDERS=1`(deterministic fake LLM/ASR/TTS)+ `MERISM_LIVE_TESTS=1`。记为 NEXT,见 tasks。
