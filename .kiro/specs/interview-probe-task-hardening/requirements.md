# Requirements Document

## Feature: interview-probe-task-hardening(LiveKit 访谈追问任务 tool 收紧)

## Introduction

本需求文档对应 Spec **interview-probe-task-hardening**,目的是把
`apps/agent/agent/interview/tasks/question.py::LiveKitQuestionTask` 当前**静态装饰器注册**的两个 LiveKit
function_tool(`record_probe_round` / `complete_question`)收紧为**按 question 配置 conditional 注册**,
并给 `record_probe_round` 加一个 `confirmation_heard: bool` self-reporting 参数,让 LLM 在 chat history
里留痕:它声称自己"已经口头追问过、并听到回答"才被允许记账。

借鉴对象是 LiveKit Agents 官方两条 best practice:

- [Tool loop design § Focus the toolset](https://docs.livekit.io/agents/logic/tools/design/#focus-the-toolset)
  ——"Aim for 5 to 10 tools per agent",不需要的 tool 不应出现在 LLM 视野里;**Dynamically register tools**
  是官方推荐手段(同页 § "Dynamically register tools" 一节明确推荐)。
- [Tool loop design § Gate critical actions](https://docs.livekit.io/agents/logic/tools/design/#gate-critical-actions)
  ——"Don't trust the model to fire the right tool at the right time. Track state in code and require the
  model to confirm before the action runs. A self-reporting parameter makes the model's intent visible
  so your code can enforce it." 官方原型是 `confirm_reservation(..., read_back: bool)`。

本 Spec 包含 5 项约束,只动 `apps/agent/agent/interview/tasks/question.py` 一个文件 + 配套测试。
**不**改 `packages/contracts` 任何 schema、**不**改 Function 侧 mapper、**不**改 supervisor / workflow / engine,
**不**改 web 侧任何代码。

## Prerequisite

- `.kiro/specs/ai-interview-engine/design.md` §B(LiveKit Supervisor pattern / `interview/{workflow,supervisor,engine,tasks}` 分层)
- `.kiro/specs/ai-interview-engine/tasks.md` G3(✅,`InterviewSupervisorAgent(instructions=workflowConfig.supervisorInstruction)` 通路;本 Spec 不动 instruction 通路)
- `docs/adr/0001-livekit-supervisor-interview-workflow.md`(LiveKit Supervisor + ordered TaskGroup + focused AgentTask 是唯一 realtime 访谈控制层)
- `AGENTS.md` § "Two LLM Chains" + § "LiveKit Agent 关键代码点"(本 Spec 改动仅落 `agent/interview/tasks/question.py`,完全在 LiveKit Agent 链内,与 Morris 链零交叉)
- `.kiro/steering/architecture.md` § "Agent realtime ↔ persistence boundary"(`livekit-agents` 模块在 `agent/interview/` 必须 lazy import;`tasks/question.py::create_question_task_class()` 是当前 lazy-import factory,本 Spec 改造**必须保留**这个 factory 形态)
- `.kiro/steering/contracts.md`(本 Spec **不改**任何 cross-module 契约;`ProbeConfig` / `ProbeRound` / `QuestionTaskConfig` / `QuestionTaskResult` 形状不变)
- `.kiro/steering/testing.md` 四层测试模型(Unit + Property 必须与代码同 PR;Layer 4 conversational tests 阻塞在 `MERISM_FAKE_PROVIDERS` 工厂未落地,本 Spec 不要求 Layer 4)
- 借鉴来源(官方文档,verify against agents 1.6.x):
  - <https://docs.livekit.io/agents/logic/tools/design/#focus-the-toolset>
  - <https://docs.livekit.io/agents/logic/tools/design/#gate-critical-actions>
  - <https://docs.livekit.io/agents/logic/tools/definition/#creating-tools-programmatically>(`function_tool` 当作 callable 使用的 API,而非装饰器)

## Glossary

| 术语 | 含义 |
|---|---|
| **LiveKitQuestionTask** | `apps/agent/agent/interview/tasks/question.py::create_question_task_class()` 工厂返回的 `AgentTask[QuestionTaskResult]` 子类;每个访谈 question 在 Supervisor 调度下创建一个实例。Lazy 导入 `livekit-agents` 以满足 `architecture.md` 约束。 |
| **ConditionalToolRegistration** | 在 `LiveKitQuestionTask.__init__` 中按 `question.probeConfig` 决定向 `super().__init__(tools=...)` 传入哪几个 `function_tool(...)` callable。借鉴 LiveKit doc § "Dynamically register tools"。 |
| **SelfReportingConfirmation** | `record_probe_round` 新增的 `confirmation_heard: bool` 参数。LLM 必须显式声明"我口头追问了 + 听到了回答"才允许记账。借鉴 LiveKit doc § "Gate critical actions" 的 `read_back` 原型。 |
| **ProbeGateRejection** | tool 在 `confirmation_heard=False` 或 `_max_rounds` 已用尽时返回的引导字符串。**不**抛 ToolError(避免污染 chat history 出现错误态);返回普通字符串引导 LLM 下一步。 |
| **Tool Visibility** | LiveKit 把 task `tools=[...]` 列表里的每个 tool 的 `name + description + parameters JSON schema` 全量塞进 LLM 的 system prompt。tool 不在列表 ⇒ LLM 看不到 ⇒ LLM 无法调用。本 Spec 利用这条性质做强约束(对比"挂着但运行时拒绝"的弱约束)。 |

## Scope

**包含**:

1. `LiveKitQuestionTask.__init__` 改造:把当前两个 `@function_tool()` 装饰器形式注册的方法,迁移到**构造时按条件挂载**的 `tools=[function_tool(...), ...]` 列表形式。
2. `record_probe_round` 仅在 `question.probeConfig is not None and question.probeConfig.maxRounds > 0` 时挂载。其他情况(`probeConfig is None` 或 `maxRounds == 0`)LLM 看不到该 tool。
3. `complete_question` 一律挂载(任何 question 都必须能结束)。
4. `record_probe_round` 新增 `confirmation_heard: bool` 参数 + description 文案;Python 实现内 gate:`confirmation_heard == False` 时**不**追加到 `self._rounds`,直接返回 ProbeGateRejection 字符串引导 LLM 重试。
5. `build_question_instructions` 文本同步:让 LLM 知道 confirmation 字段如何填(对应 description 里"NEVER set True for a probe you only thought about" 风格)。
6. 配套测试(新文件 `apps/agent/tests/test_question_task.py`):覆盖 conditional registration 的两条主路径 + confirmation gate 的 true/false 双向用例 + maxRounds 上限保护未受影响。
7. 在 `AGENTS.md § "LiveKit Agent 关键代码点"` 章节追加一行说明 probe tool 当前的 gating 形态(避免下次有人重新静态化注册)。

**排除**:

- 不引入 watchdog timeout(改进 3 推迟到下一 sub-spec,需先用 Agents Console 观测真实"LLM 沉默"发生率,目前无数据支撑)。
- 不引入 LiveKit Test framework conversational tests(改进 4b)。阻塞在 `MERISM_FAKE_PROVIDERS=1` 工厂未落地(`.kiro/steering/errors-and-observability.md::Feature flags` 注册为"规划中,未实现";`.kiro/specs/ai-interview-engine/tasks.md::L1` 把 fake provider 工厂列为先决条件)。本 Spec 用单元 + property 测试覆盖,Layer 4 等 L1 落地后再补。
- 不动 `packages/contracts/src/{entities,api,state}.ts`(`ProbeConfig` 字段 / `ProbeRound` 字段 / `QuestionTaskConfig` 字段 / `QuestionTaskResult` 字段全部不变)。
- 不动 `apps/agent/agent/contracts.py`(Python mirror 不变)。
- 不动 `apps/functions/issueLivekitToken/`(刚在 `interview-probe-task-hardening` 这个 spec 之前的 commit 修过 `moderatorInstruction` 透传;本 Spec 与那条链平行,不重叠)。
- 不动 `apps/agent/agent/interview/{workflow,supervisor,engine,transcript}.py`(Supervisor 调度逻辑、TaskGroup 顺序、room metadata 通路全部不变)。
- 不动 `apps/agent/agent/providers/` 任何 provider 适配器。
- 不动 `apps/agent/tests/load/{cascade,live}_pressure_test.py`(load test 用 tool name 字面量;本 Spec 不改 tool name)。
- 不动 web 侧任何代码 / Morris 链(改造完全在 LiveKit Agent 链内)。
- 不引入新 contracts schema 字段、新 Appwrite 列、新 env flag、新依赖。

## Requirements

### Requirement 1: Tool 注册方式从装饰器迁移到 conditional callable

**User Story:** 作为 LiveKit Agent 维护者,我需要 `LiveKitQuestionTask` 在构造时按 `question.probeConfig` 决定 tool 列表,以便不需要追问的 question 不向 LLM 暴露 `record_probe_round`,既省 token 又消除误调路径。

#### Acceptance Criteria

1. WHEN `LiveKitQuestionTask.__init__` 执行 THEN `super().__init__(...)` 调用 SHALL 显式传 `tools=[<callable>, ...]` 参数,而不是依赖 `@function_tool()` 装饰器在类作用域注册。
2. WHEN `question.probeConfig is None` THEN 构造出的 task 实例的 LiveKit tools 列表 SHALL **不**包含 `record_probe_round`,SHALL 包含 `complete_question`。
3. WHEN `question.probeConfig is not None and question.probeConfig.maxRounds <= 0` THEN 构造出的 task 实例的 LiveKit tools 列表 SHALL **不**包含 `record_probe_round`,SHALL 包含 `complete_question`。(虽然 zod schema 在 contracts 层强制 `maxRounds.positive()`,Python `BaseModel` 仍可能在测试 / legacy 数据中遇到 0;防御性兼容。)
4. WHEN `question.probeConfig is not None and question.probeConfig.maxRounds > 0` THEN 构造出的 task 实例的 LiveKit tools 列表 SHALL 同时包含 `record_probe_round` 和 `complete_question`,共 2 项。
5. WHEN `livekit-agents` 未安装(`uv sync` 不带 `--extra realtime`)THEN `pnpm test:py` SHALL 仍能加载 `agent.interview.tasks.question` 模块(top-level import 不引入 livekit symbols;沿用现有 `create_question_task_class()` 工厂的 lazy import 形态)。

---

### Requirement 2: `record_probe_round` 加 `confirmation_heard` 自报家门参数

**User Story:** 作为 LiveKit Agent 维护者,我需要 `record_probe_round` 强制 LLM 在调用时声明"我已经口头追问 + 听到回答",以便:(a) chat history 留痕、后续 turn 看得见 LLM 的承诺;(b) Python 侧拒绝任何 `confirmation_heard=False` 的调用,防止 LLM 把主问题答案错记成 probe round。

#### Acceptance Criteria

1. WHEN `record_probe_round` 被 LLM 调用 THEN 其 Python 函数签名 SHALL 含**三个**业务参数:`probe_question: str`、`probe_respondent_answer: str`、`confirmation_heard: bool`(顺序无关;关键是三者必填,LLM 在 JSON schema 里看到 required 三项)。
2. WHEN `confirmation_heard == False` THEN 该次调用 SHALL **不**追加任何元素到 `self._rounds`,SHALL **不**改变 `self._completed` 状态,SHALL 返回一段引导字符串(具体文案见 design.md §3.2),指引 LLM "先口头问出 probe → 听完回答 → 再 call 一次 tool 并 set true"。
3. WHEN `confirmation_heard == True` 且当前轮次未触上限(`len(self._rounds) < self._max_rounds`)且 task 未完成(`self._completed == False`)THEN 该次调用 SHALL 追加一个 `ProbeRound(probeQuestion=probe_question, respondentAnswer=probe_respondent_answer)` 到 `self._rounds`,SHALL 返回现有的"Recorded probe X/Y. Ask another / call complete_question" 类引导(沿用现有文案)。
4. WHEN `confirmation_heard == True` 但 `self._completed == True`(UI 抢先 click 完成)THEN 沿用现有"This question was already answered on screen. Move on." 返回(不变)。
5. WHEN `confirmation_heard == True` 但 `len(self._rounds) >= self._max_rounds` THEN 沿用现有 "Probe limit of N already reached. Do not ask another probe..." 返回(不变)。
6. WHERE 参数 `confirmation_heard` 的 docstring THEN 文案 SHALL 包含三层信息:(a) 何时 set True(实际口头问完 + 实际听到回答的且仅且);(b) 何时 set False(还没问 / 还没听到);(c) 显式 anti-pattern("NEVER set True for a probe you only thought about asking but did not voice")。

---

### Requirement 3: `build_question_instructions` 系统提示同步

**User Story:** 作为 LiveKit Agent 的研究员,我需要 system prompt 与新的 tool 形态对齐——告诉 LLM `confirmation_heard` 参数的语义,避免 LLM 看到陌生参数胡乱填。

#### Acceptance Criteria

1. WHEN `question.probeConfig is not None and question.probeConfig.maxRounds > 0` THEN `build_question_instructions(question)` 返回的字符串 SHALL 在原有 probe 段后追加一句明确的指引:"When calling record_probe_round, set confirmation_heard=True ONLY after you have actually voiced the probe and heard the respondent's answer. Set False if you have not yet asked or the respondent has not yet answered." (具体措辞见 design.md §4)。
2. WHEN `question.probeConfig is None or question.probeConfig.maxRounds == 0` THEN `build_question_instructions(question)` 返回的字符串 SHALL **不**包含任何 probe 段(沿用现有 `if probe is not None:` 守卫;`maxRounds == 0` 时也跳过)。
3. WHERE prompt 文案 THEN SHALL **不**提及 `complete_question` 或 `record_probe_round` 的内部 Python 实现细节(沿用现有 `Do not invent fields outside the tool arguments. Do not expose internal task names.` 准则)。

---

### Requirement 4: 单元 + property 测试覆盖

**User Story:** 作为 LiveKit Agent 维护者,我需要 conditional registration + confirmation gate 的回归 guard 与代码同 PR,以便未来重构不会静默回退到"装饰器静态注册 + 无 confirmation"形态。

#### Acceptance Criteria

1. WHEN 新建 `apps/agent/tests/test_question_task.py` THEN 该文件 SHALL 含至少以下用例集:
   - **TC-1** `probeConfig=None` → task.tools 列表 names 集合 == `{"complete_question"}`
   - **TC-2** `probeConfig.maxRounds=3`(standard)→ task.tools 列表 names 集合 == `{"complete_question", "record_probe_round"}`
   - **TC-3** `probeConfig.maxRounds=5`(deep)→ 同 TC-2
   - **TC-4** `probeConfig.maxRounds=0`(防御性 / legacy)→ 同 TC-1
   - **TC-5** `record_probe_round(... confirmation_heard=False)` → `self._rounds` 长度未变 + 返回字符串含 "actually" / "ask" 关键字(粗匹配)
   - **TC-6** `record_probe_round(... confirmation_heard=True)` → `self._rounds` 长度 +1 + 返回字符串含 "Recorded probe 1/" 前缀
   - **TC-7** `record_probe_round(... confirmation_heard=True)` 重复调用至 `maxRounds`,第 `maxRounds+1` 次返回 "Probe limit of N already reached"(沿用现有上限保护未受影响)
2. WHEN `pnpm test:py` 运行 THEN 全套 Python 测试(含新增 7 条用例)SHALL 全绿,且不需要 `--extra realtime`(测试通过 `create_question_task_class()` 工厂在测试体内 lazy 实例化即可,与现有 `test_livekit_smoke.py` 风格一致)。
3. WHEN `apps/agent/tests/load/{cascade,live}_pressure_test.py` 跑 THEN load test SHALL **不**受本 Spec 改动影响(它们用 tool name 字面量 `record_probe_round` / `complete_question`,本 Spec 不改 tool name)。
4. WHERE property test THEN 新增 `apps/agent/tests/properties/test_probe_tool_gate.py`(参 `tests/properties/_template.test.ts` 同构),用 `hypothesis` 跑:对任意 `ProbeConfig`(level ∈ {standard, deep}、instruction ∈ str、maxRounds ∈ [0..10]),`LiveKitQuestionTask` 暴露的 tool 名称集合 SHALL 满足 R1 §2-§4 的不变量(`record_probe_round` 当且仅当 `probeConfig is not None and maxRounds > 0`)。

---

### Requirement 5: 文档同步(AGENTS.md 备忘 + spec roadmap)

**User Story:** 作为接手代码的下一个工程师,我需要 `AGENTS.md` 反映 probe tool 当前是 conditional-registered 形态,以避免重构时不知情地静态化回去。

#### Acceptance Criteria

1. WHEN 本 Spec 合并 THEN `AGENTS.md § "LiveKit Agent 关键代码点 (`apps/agent/agent/interview/`)" 列表 SHALL 追加一行(在 `tasks/question.py` 描述附近)说明:"`tasks/question.py::LiveKitQuestionTask` 的 `record_probe_round` 在构造时按 `question.probeConfig.maxRounds > 0` conditional 挂载;`confirmation_heard: bool` 自报家门参数在 false 时拒绝记账。改回静态装饰器或移除 confirmation 参数会破坏 P-FLOW-06 / P-FLOW-07 property test。"
2. WHEN 本 Spec 合并 THEN `README.md § Sub-spec roadmap` 表格 SHALL 追加一行:`| **interview-probe-task-hardening** ✅ | LiveKitQuestionTask conditional tool registration + confirmation_heard self-reporting gate. 借鉴 LiveKit Agents Tool loop design (Focus the toolset + Gate critical actions). 见 `.kiro/specs/interview-probe-task-hardening/`. | foundation-setup, ai-interview-engine |`(状态 ✅ 表示 spec 落地,代码同 PR)
3. WHEN 本 Spec 合并 THEN `.kiro/specs/ai-interview-engine/tasks.md` SHALL **不**新增 task(本 Spec 是 ai-interview-engine 的独立强化,不在 G1-G3 / L1-L2 范围;也不动 G3 ✅ 状态)。
4. WHERE 新增/修改的文档段落 THEN SHALL 使用项目既有词表(LiveKit Supervisor / AgentTask / function_tool / RunContext;不引入 "skill" / "plugin" / "hook" 等非项目词)。
