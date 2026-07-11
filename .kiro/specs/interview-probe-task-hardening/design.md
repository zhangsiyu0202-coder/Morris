# Design — interview-probe-task-hardening

> Prerequisite: 见 `requirements.md § Prerequisite`。
> 本 design 假设读者已读 LiveKit 官方 [Tool loop design](https://docs.livekit.io/agents/logic/tools/design/) 与 [Function tools](https://docs.livekit.io/agents/logic/tools/definition/) 两页,以及我们项目的 `apps/agent/agent/interview/tasks/question.py` 当前实现。

## §1 高层设计

只动一个文件:`apps/agent/agent/interview/tasks/question.py`(+ 配套测试文件)。改造前后的形态对比:

### Before(当前)

```
LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
    ── @function_tool() record_probe_round(probe_question, probe_respondent_answer)
    ── @function_tool() complete_question(respondent_answer)

每个 question 实例 → LLM 看到 2 个 tool(总是)
record_probe_round 内部按 self._max_rounds 运行时拒绝(挂着但礼貌拒绝)
```

### After(本 Spec)

```
LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
    def __init__(question, ...):
        tools = [function_tool(self._complete_question_impl, name="complete_question", ...)]
        probe = question.probeConfig
        if probe is not None and probe.maxRounds > 0:
            tools.append(function_tool(self._record_probe_round_impl, name="record_probe_round", ...))
        super().__init__(tools=tools, ...)

record_probe_round 参数加 confirmation_heard: bool
  False → 不记账 + 返回引导字符串
  True  → 走原有 maxRounds / completed gate 链
```

两条关键性质:

| 改动 | 性质 | 强度 |
|---|---|---|
| Conditional registration | LLM **看不到** record_probe_round ⇒ 调不到 | 强(由 LiveKit Agents framework 保证) |
| `confirmation_heard` gate | LLM 调了但 set False ⇒ Python 拒绝记账 | 中(LLM 仍可 lie 设 True;但 chat history 留痕、后续 turn 受约束) |

两者**叠加**,不互相替代:
- 单靠 conditional registration → maxRounds > 0 的 question 下,LLM 看到 tool 后仍可能把主问题答案错记成 probe round。
- 单靠 confirmation_heard → maxRounds = 0 的 question 下,LLM 看到 tool 仍占 prompt token、仍可能误调浪费 `max_tool_steps` 预算(默认 3,LiveKit 官方 [Bound the loop](https://docs.livekit.io/agents/logic/tools/design/#bound-the-loop))。

## §2 Conditional registration 实现

### §2.1 API 选择:`function_tool(callable, name=, description=)` 不是装饰器

LiveKit 官方 [Function tools § Creating tools programmatically](https://docs.livekit.io/agents/logic/tools/definition/#creating-tools-programmatically) 给出的 API(原文已 fetch verify against agents 1.6.x):

```python
class Assistant(Agent):
    def __init__(self):
        super().__init__(
            tools=[
                function_tool(
                    self._set_profile_field_func_for("phone"),
                    name="set_phone_number",
                    description="Call this function when user has provided their phone number.",
                ),
                function_tool(
                    self._set_profile_field_func_for("email"),
                    name="set_email",
                    description="Call this function when user has provided their email.",
                ),
            ],
        )
```

我们沿用同款形态。当前文件已经 lazy import `livekit-agents`(在 `create_question_task_class()` 工厂内 `from livekit.agents import AgentTask, function_tool`),改造**不改变** lazy import 时序——只是把内部用法从装饰器换成 callable。

### §2.2 改造后的 `LiveKitQuestionTask.__init__` 形态

```python
def create_question_task_class():
    from livekit.agents import AgentTask, function_tool

    class LiveKitQuestionTask(AgentTask[QuestionTaskResult]):
        def __init__(
            self,
            question: QuestionTaskConfig,
            chat_ctx=None,
            on_enter_publish: Callable[[Any], None] | None = None,
        ) -> None:
            self.question = question
            self._on_enter_publish = on_enter_publish
            self._completed = False
            self._rounds: list[ProbeRound] = []

            # ConditionalToolRegistration: complete_question 总是注册;
            # record_probe_round 仅在 question 真要追问时挂载。
            tools: list[Any] = [
                function_tool(
                    self._complete_question_impl,
                    name="complete_question",
                    description=COMPLETE_QUESTION_DESCRIPTION,
                ),
            ]
            probe = question.probeConfig
            if probe is not None and probe.maxRounds > 0:
                tools.append(
                    function_tool(
                        self._record_probe_round_impl,
                        name="record_probe_round",
                        description=_record_probe_round_description(probe.maxRounds),
                    )
                )

            super().__init__(
                instructions=build_question_instructions(question),
                chat_ctx=chat_ctx,
                tools=tools,
            )
```

注意点:

- `self._complete_question_impl` / `self._record_probe_round_impl` 是 plain async method(不带 `@function_tool` 装饰器,沿用 `_max_rounds` 等同样的私有属性命名)。`function_tool(callable, ...)` 接受 bound method,LiveKit 通过反射读取参数签名 + type hints 生成 LLM 的 tool JSON schema。
- description 是 `str` 常量(`COMPLETE_QUESTION_DESCRIPTION`)或带 `maxRounds` 注入的工厂函数(`_record_probe_round_description(n)`),把字面值写进 description 让 LLM 看到具体上限。
- `tools=tools` 必须传给 `super().__init__()`,父类 `AgentTask` 接收 `tools` 关键字参数(同 LiveKit `Agent.__init__` 形态;见 [Function tools § Adding tools dynamically](https://docs.livekit.io/agents/logic/tools/definition/#adding-tools-dynamically) 给的 AgentA / AgentB 例)。

### §2.3 description 文案

为了让 LLM 在 5-10 tool 列表上下文里准确选 tool,description 按 LiveKit [Write descriptions the model can act on](https://docs.livekit.io/agents/logic/tools/design/#write-descriptions-the-model-can-act-on) 规则写"做什么 / 何时调 / 何时不调":

```python
COMPLETE_QUESTION_DESCRIPTION = """\
Finish the current interview question and submit the respondent's consolidated answer.

Call this when:
- For a non-probing question: as soon as the respondent has given their answer.
- For a probing question: after you have completed at least one probe round
  (recorded via record_probe_round) and you judge the answer is fully explored.

Do not call this:
- Before the respondent has answered the main question.
- For a probing question, before any record_probe_round has been recorded.

Args:
    respondent_answer: The consolidated answer to the main question, as a
        single string. For multi-turn answers, summarize what the respondent
        actually said in their own voice — do not paraphrase or interpret.
"""


def _record_probe_round_description(max_rounds: int) -> str:
    return f"""\
Record one probe exchange (a follow-up question and the respondent's answer to it).

This question allows up to {max_rounds} probe rounds. The tool will reject
recording beyond {max_rounds} rounds and tell you to call complete_question.

Call this:
- AFTER you have voiced a probing follow-up out loud AND heard the respondent answer.
- Once per probe round; do not batch multiple probes into one call.

Do not call this:
- For a probe you only thought about asking but did not voice.
- Before the respondent has answered the probe.
- When this question is not configured for probing (you will not see this tool
  in that case; if you somehow see it without configuration, do not call it).

Args:
    probe_question: The probe follow-up you actually voiced — the literal
        sentence you asked the respondent, not a paraphrase or a probe you
        only considered.
    probe_respondent_answer: The respondent's actual spoken answer to the
        probe. Include refusals or "I don't know" verbatim; do not substitute
        a placeholder.
    confirmation_heard: Self-reporting gate. Set True ONLY after BOTH:
        (1) you have actually voiced the probe question, AND
        (2) the respondent has actually answered (any answer, including
            refusal or "I don't know").
        Set False if you have not yet asked OR if the respondent has not yet
        answered. NEVER set True for a probe you only thought about asking
        but did not voice.
"""
```

文案在 module-level 定义,既便于测试 grep,也避免每次 init 重新构造长字符串。`COMPLETE_QUESTION_DESCRIPTION` 是常量(`Final[str]`);`_record_probe_round_description(max_rounds)` 是因为 `max_rounds` 需要注入,所以保持工厂函数形态。

## §3 `record_probe_round` 加 `confirmation_heard` 参数

### §3.1 改造后的方法签名

```python
async def _record_probe_round_impl(
    self,
    probe_question: str,
    probe_respondent_answer: str,
    confirmation_heard: bool,
) -> str:
    """Record one probe exchange. See module-level _record_probe_round_description for full description."""
    # SelfReportingConfirmation gate — must come FIRST, before any state check,
    # so that confirmation_heard=False is a no-op (no completed/maxRounds branch fires).
    if not confirmation_heard:
        return PROBE_GATE_REJECTION

    # Existing gates (unchanged order):
    if self._completed:
        return "This question was already answered on screen. Move on."
    # 注意:_max_rounds <= 0 这一分支理论上不会触发,因为 conditional
    # registration 在 __init__ 已经把 record_probe_round 从工具列表里排掉了。
    # 但为防御性测试 / legacy 路径,保留运行时挡板。
    if self._max_rounds <= 0:
        return (
            "This question is not configured for probing. "
            "Call complete_question now."
        )
    if len(self._rounds) >= self._max_rounds:
        return (
            f"Probe limit of {self._max_rounds} already reached. "
            "Do not ask another probe — call complete_question now."
        )

    self._rounds.append(
        ProbeRound(
            probeQuestion=probe_question,
            respondentAnswer=probe_respondent_answer,
        )
    )
    used = len(self._rounds)
    if used >= self._max_rounds:
        return (
            f"Recorded probe {used}/{self._max_rounds}. "
            "Probe limit reached — call complete_question now."
        )
    return (
        f"Recorded probe {used}/{self._max_rounds}. "
        "Ask another probe if useful, or call complete_question to finish."
    )
```

### §3.2 `PROBE_GATE_REJECTION` 文案

```python
PROBE_GATE_REJECTION: Final[str] = (
    "You must actually voice the probe out loud and wait for the respondent's "
    "answer before recording. Ask the probe now; after you hear the response, "
    "call this tool again with confirmation_heard=True. If the respondent is "
    "refusing or has gone silent, you may still record with the verbatim "
    "refusal or 'no answer' as probe_respondent_answer — but only after you "
    "actually heard them say so."
)
```

文案设计要点:

- **明确"该怎么纠正"** — 不是单纯说 "wrong",而是告诉 LLM "ask first, hear answer, then call with true"。
- **覆盖 edge case** — 用户沉默 / 拒答时怎么办(允许 verbatim "no answer" 记账,只要确实听到拒答这个信号)。
- **避免触发 LLM 的"道歉"模式** — 不用 "you violated" / "you did wrong" 这类词,免得 LLM 接下来一通道歉污染 chat。

### §3.3 顺序为什么 confirmation 在最前

放在最前有两个理由:

1. **`confirmation_heard=False` 是常见路径**(LLM 第一次"想到要追问"时往往还没问)。早返回省 CPU 也省 chat history(只塞一个引导,不塞 "Recorded ..." 类成功消息)。
2. **不污染 `self._completed` / `self._rounds` 路径** — false 不该触发 "already completed" 或 "limit reached" 分支,因为那些消息意味着"你已经发生过这个动作了",会让 LLM 误以为系统状态变了。

## §4 `build_question_instructions` 修改

在现有 `probe_text` 段末尾追加 confirmation 指引;`if probe is not None:` 守卫不变,但**加入 `and probe.maxRounds > 0` 条件**,与 conditional registration 同步:

```python
def build_question_instructions(question: QuestionTaskConfig) -> str:
    probe = question.probeConfig
    probe_text = ""
    # 与 conditional registration 同步:只有真要追问时才注入 probe 段
    if probe is not None and probe.maxRounds > 0:
        guidance = probe.instruction.strip() or "(no specific guidance — probe at your discretion)"
        probe_text = f"""

Probing (this question is always probed):
- Probe level: {probe.level}
- Probe guidance: {guidance}
- Maximum probe rounds: {probe.maxRounds}
- You MUST ask at least one probe before finishing this question — never jump
  straight to the next question. That feels robotic and loses the human touch.
- After each probe exchange, call record_probe_round with the probe question,
  the respondent's answer, AND confirmation_heard=True.
- Set confirmation_heard=True ONLY after you have ACTUALLY voiced the probe and
  ACTUALLY heard the respondent answer it. Never set True for a probe you only
  thought about asking.
- You MAY stop probing early once you feel the answer is fully explored — you do
  not have to use all {probe.maxRounds} rounds.
- You may never exceed {probe.maxRounds} probe rounds. Once you reach the limit,
  finish the question.
- When you are done, call complete_question with the consolidated answer to the
  main question.
"""

    # options_text / stimulus_text / 主模板不变 ...
```

注意:中文 guidance 在原代码用"(无特定指引,自行判断如何深入。)"。本 Spec 把它统一成英文 "(no specific guidance — probe at your discretion)",**与 system prompt 主体语言一致**(主体都是英文)。这是顺手清理,不增加 user-visible 行为变化(LLM 看英文准确率略高;研究员看不到 instruction)。

## §5 Correctness Properties

新增以下 property 到 `ai-interview-engine` 的 P-FLOW 系列(继承 sub-spec area):

| ID | 不变量 | 测试位置 |
|---|---|---|
| **P-FLOW-06** | 对任意合法 `QuestionTaskConfig`,`LiveKitQuestionTask(question).tools` 名称集合 == `{"complete_question"} ∪ ({"record_probe_round"} if question.probeConfig is not None and question.probeConfig.maxRounds > 0 else ∅)` | `apps/agent/tests/properties/test_probe_tool_gate.py` |
| **P-FLOW-07** | 对任意 `QuestionTaskConfig`(probeConfig.maxRounds > 0)和任意 `(probe_q, probe_a)` 字符串对,`record_probe_round(probe_q, probe_a, confirmation_heard=False)` 调用 N 次后 `task._rounds` 长度仍为 0 | `apps/agent/tests/properties/test_probe_tool_gate.py` |

property test 用 `hypothesis` 生成:

- `level ∈ {"standard", "deep"}`(`st.sampled_from`)
- `instruction ∈ str`(`st.text(min_size=0, max_size=200)`)
- `maxRounds ∈ [0, 10]`(`st.integers(0, 10)`;覆盖 0 / 1 / 边界 / 中段)
- `probeConfig ∈ Optional[ProbeConfig]`(`st.one_of(st.none(), st.builds(...))`)

每次生成一个 `LiveKitQuestionTask` 实例,断言 tool name 集合满足 P-FLOW-06。

## §6 不引入的东西(决定记录)

| 不做 | 原因 | 何时再考虑 |
|---|---|---|
| Watchdog timeout(LLM 沉默时代码推一句) | 需要先用 Agents Console 观测真实"LLM 沉默"发生率,目前无数据;改造复杂(asyncio + cancel + race)远超本 Spec 范围 | 拿到一周生产 Console 数据,确认有 ≥ 1% 的 question 出现 "no probe before complete" 时,开新 sub-spec |
| LiveKit conversational test(`session.run(user_input=...)` 走完整 STT-LLM-TTS) | 阻塞在 `MERISM_FAKE_PROVIDERS=1` 工厂未落地;真 LLM 跑 CI 会 flake + 烧钱 | `ai-interview-engine/tasks.md::L1` 落地后,补到本 spec 同名测试目录 |
| 改 `confirmation_heard` 为更强 gate(比如比对 transcript) | 复杂度陡升:需要 STT pipeline access + 时间窗 + 模糊匹配;LLM 90%+ 服从 self-reporting 已够 | 观测到 self-reporting 服从率 < 70% 时(用 Agents Console 跑 ~50 场抽样统计) |
| 改 tool name(`record_probe_round` → `confirm_and_record_probe`) | 会破坏 `apps/agent/tests/load/{cascade,live}_pressure_test.py` 字面量(72/86 行);load test 是 ai-interview-engine L1 收口债依赖,不动 | 永远不改名(name 是稳定接口) |

## §7 风险与回退

### §7.1 主要风险

1. **`function_tool(callable, name=, description=)` 的反射推断在 lazy import 路径下行为不同于装饰器** — 不应有差异(LiveKit 内部 `function_tool` 不论 decorator 还是 callable 形态,最终都走同一条注册路径),但本 Spec 是项目第一次切换形态,有可能踩到 LiveKit 1.6.x 边缘 case。**Mitigation**:T1 任务完成后先跑 `apps/agent/tests/test_livekit_smoke.py`(它真 import `livekit-agents` 验证 InterviewSupervisorAgent 实例化),smoke 失败立即回退。
2. **现有 LLM 调用习惯被打破** — 旧 prompt 没说 `confirmation_heard` 字段;LLM 第一次跑改造后的 prompt 可能频繁返回 false。**Mitigation**:Description 文案在 §2.3 已经给"how to recover" 引导,加上 `build_question_instructions` 在 §4 已经在 system prompt 段说明该字段语义;LLM 应在 1-2 turn 内学会。第一周观测 Agents Console。

### §7.2 回退策略

本 Spec 改动**完全在一个文件**(`apps/agent/agent/interview/tasks/question.py`)。若发现生产问题:

- `git revert <commit>` → 该文件回到装饰器形态。
- 因为不动 contracts / mapper / supervisor / workflow,回退**不会**留下半截 schema 或 dangling reference。

回退**唯一**需要同步的事:把 `AGENTS.md` 那行追加描述也 revert(`README.md sub-spec roadmap` 行可以保留为"已规划,待实现"状态)。

## §8 单元 / property test 结构

### §8.1 `apps/agent/tests/test_question_task.py`(新建)

```python
"""Unit tests for LiveKitQuestionTask conditional tool registration + confirmation gate.

Mirrors apps/agent/tests/test_livekit_smoke.py shape: real livekit-agents
import gated by a try/except so the file does not block `uv sync` without
--extra realtime. When the extra is absent, the entire test module is skipped.
"""
from __future__ import annotations

import pytest

livekit_agents = pytest.importorskip("livekit.agents")

from agent.contracts import ProbeConfig, QuestionTaskConfig
from agent.interview.tasks.question import create_question_task_class


def _make_question(probe: ProbeConfig | None) -> QuestionTaskConfig:
    return QuestionTaskConfig(
        questionId="q1",
        questionType="open_ended",
        questionContent="Tell me about your last trip booking.",
        options=[],
        probeConfig=probe,
        stimulus=None,
    )


def _tool_names(task) -> set[str]:
    # LiveKit AgentTask 的 tools 是 list[FunctionTool];每个 tool 有 .id 属性
    # (per LiveKit Function tools doc § Tool IDs).
    return {t.id for t in task.tools}


@pytest.fixture
def TaskCls():
    return create_question_task_class()


# TC-1
def test_no_probe_config_hides_record_probe_round(TaskCls):
    task = TaskCls(question=_make_question(probe=None))
    assert _tool_names(task) == {"complete_question"}


# TC-2
def test_standard_probe_exposes_both_tools(TaskCls):
    probe = ProbeConfig(level="standard", instruction="probe lightly", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question", "record_probe_round"}


# TC-3
def test_deep_probe_exposes_both_tools(TaskCls):
    probe = ProbeConfig(level="deep", instruction="probe deeply", maxRounds=5)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question", "record_probe_round"}


# TC-4
def test_max_rounds_zero_hides_record_probe_round(TaskCls):
    probe = ProbeConfig(level="standard", instruction="", maxRounds=0)
    task = TaskCls(question=_make_question(probe=probe))
    assert _tool_names(task) == {"complete_question"}


# TC-5 / TC-6 / TC-7
@pytest.mark.asyncio
async def test_confirmation_false_does_not_record(TaskCls):
    probe = ProbeConfig(level="deep", instruction="", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))
    result = await task._record_probe_round_impl(
        probe_question="Why did you pick Airbnb?",
        probe_respondent_answer="It's habit.",
        confirmation_heard=False,
    )
    assert len(task._rounds) == 0
    assert "ask" in result.lower() or "actually" in result.lower()


@pytest.mark.asyncio
async def test_confirmation_true_records_and_counts(TaskCls):
    probe = ProbeConfig(level="deep", instruction="", maxRounds=3)
    task = TaskCls(question=_make_question(probe=probe))
    result = await task._record_probe_round_impl(
        probe_question="Why Airbnb?",
        probe_respondent_answer="Habit.",
        confirmation_heard=True,
    )
    assert len(task._rounds) == 1
    assert result.startswith("Recorded probe 1/3")


@pytest.mark.asyncio
async def test_confirmation_true_max_rounds_protection(TaskCls):
    probe = ProbeConfig(level="standard", instruction="", maxRounds=2)
    task = TaskCls(question=_make_question(probe=probe))
    for i in range(2):
        await task._record_probe_round_impl(
            probe_question=f"q{i}",
            probe_respondent_answer=f"a{i}",
            confirmation_heard=True,
        )
    assert len(task._rounds) == 2
    over = await task._record_probe_round_impl(
        probe_question="q3",
        probe_respondent_answer="a3",
        confirmation_heard=True,
    )
    assert len(task._rounds) == 2  # 没增长
    assert "limit" in over.lower()
```

### §8.2 `apps/agent/tests/properties/test_probe_tool_gate.py`(新建)

```python
"""Property tests for P-FLOW-06 + P-FLOW-07.

Guards against silent regression to "static decorator + no confirmation"
shape that this sub-spec exists to prevent.
"""
from __future__ import annotations

import pytest

livekit_agents = pytest.importorskip("livekit.agents")

from hypothesis import given, strategies as st
from agent.contracts import ProbeConfig, QuestionTaskConfig
from agent.interview.tasks.question import create_question_task_class


TaskCls = create_question_task_class()


def _make_question(probe: ProbeConfig | None) -> QuestionTaskConfig:
    return QuestionTaskConfig(
        questionId="q1",
        questionType="open_ended",
        questionContent="x",
        options=[],
        probeConfig=probe,
        stimulus=None,
    )


probe_config_strategy = st.one_of(
    st.none(),
    st.builds(
        ProbeConfig,
        level=st.sampled_from(["standard", "deep"]),
        instruction=st.text(min_size=0, max_size=200),
        maxRounds=st.integers(min_value=0, max_value=10),
    ),
)


@given(probe=probe_config_strategy)
def test_p_flow_06_tool_visibility_matches_probe_config(probe):
    """P-FLOW-06: record_probe_round 可见 iff probe is not None and maxRounds > 0."""
    task = TaskCls(question=_make_question(probe=probe))
    tool_names = {t.id for t in task.tools}
    assert "complete_question" in tool_names
    should_have_record = probe is not None and probe.maxRounds > 0
    assert ("record_probe_round" in tool_names) == should_have_record


@given(
    probe=st.builds(
        ProbeConfig,
        level=st.sampled_from(["standard", "deep"]),
        instruction=st.text(min_size=0, max_size=100),
        maxRounds=st.integers(min_value=1, max_value=10),
    ),
    probe_q=st.text(min_size=1, max_size=50),
    probe_a=st.text(min_size=1, max_size=50),
    n_calls=st.integers(min_value=1, max_value=5),
)
@pytest.mark.asyncio
async def test_p_flow_07_confirmation_false_never_records(probe, probe_q, probe_a, n_calls):
    """P-FLOW-07: confirmation_heard=False 调用 N 次后 _rounds 始终空。"""
    task = TaskCls(question=_make_question(probe=probe))
    for _ in range(n_calls):
        await task._record_probe_round_impl(
            probe_question=probe_q,
            probe_respondent_answer=probe_a,
            confirmation_heard=False,
        )
    assert task._rounds == []
```

property test 通过 `pytest.importorskip("livekit.agents")` 在 `uv sync` 无 `--extra realtime` 时被跳过,符合 `testing.md::Live integration gating` 的"foundation tests MUST run without realtime extra"准则。
