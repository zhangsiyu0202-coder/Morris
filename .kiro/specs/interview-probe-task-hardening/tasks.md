# Implementation Plan — interview-probe-task-hardening

每个任务保持 `pnpm test:py` 绿、`pnpm typecheck` 不受影响,改动可独立提交。所有代码改动落在 **`apps/agent/agent/interview/tasks/question.py`** 一个文件 + 两个新增 test 文件,不涉及契约 package、Functions、web、Appwrite schema、Python contracts mirror、Supervisor / workflow / engine。

依赖示意:

```
T1 ── T2 ── T3 ── T4 ── T5 ── T6 ── T7 (docs)
  └───────────┴────┘
   (Wave A)
              └───────┴────┐
              (Wave B)     │
                           └─ T6 (verify)
```

Wave 内任务可单独提交,Wave 间严格按依赖。

---

## Wave A — 代码改造(R1, R2, R3)

### T1 抽出 description 常量与工厂

**做什么**:在 `apps/agent/agent/interview/tasks/question.py` 模块顶层(`create_question_task_class()` 之外)新增三个符号:

- `COMPLETE_QUESTION_DESCRIPTION: Final[str]` —— `complete_question` 的多段 description(按 design §2.3)
- `PROBE_GATE_REJECTION: Final[str]` —— `confirmation_heard=False` 的引导文案(按 design §3.2)
- `def _record_probe_round_description(max_rounds: int) -> str:` —— 注入 `max_rounds` 字面值的 description 工厂(按 design §2.3)

**改/加**:`apps/agent/agent/interview/tasks/question.py`(+ ~50 行常量与工厂函数;**不**动 `create_question_task_class()` 内部代码)。

**验收**:
- `pnpm typecheck` 与 `pnpm test:py` 仍绿(此任务无行为变化,纯添加未使用符号)。
- `grep -n 'COMPLETE_QUESTION_DESCRIPTION\|PROBE_GATE_REJECTION\|_record_probe_round_description' apps/agent/agent/interview/tasks/question.py` 三符号皆命中。

---

### T2 `LiveKitQuestionTask.__init__` 改造为 conditional tool registration(R1)

**做什么**:把当前 `create_question_task_class()` 内 `LiveKitQuestionTask` 的两个 `@function_tool()` 装饰器形式改为构造时 `tools=[function_tool(callable, name=, description=)]` 形态(按 design §2.2)。

具体步骤:

1. 删掉 `@function_tool()` 在 `record_probe_round` 与 `complete_question` 上的装饰器。
2. 把两个方法重命名为 `_record_probe_round_impl` / `_complete_question_impl`(plain async method,不再是 tool 本身)。**保留方法体不变**。
3. 在 `__init__` 末尾构造 `tools` 列表(按 design §2.2 形态),`complete_question` 总挂、`record_probe_round` 仅在 `probe is not None and probe.maxRounds > 0` 时挂。
4. `super().__init__(...)` 调用增加 `tools=tools` 参数。

**改/加**:`apps/agent/agent/interview/tasks/question.py`(改 `create_question_task_class` 内部约 50 行)。

**验收**:
- `pnpm test:py` 仍绿(现有 `test_workflow.py` / `test_contracts.py` / `test_livekit_smoke.py` 不受影响——它们不直接断言 tool 列表)。
- 手动 sanity:`python -c "from agent.interview.tasks.question import create_question_task_class; print([t.id for t in create_question_task_class()(question=...).tools])"`(填一个合法 question)输出符合 design §2.2 形态。

---

### T3 `_record_probe_round_impl` 加 `confirmation_heard: bool` 参数(R2)

**做什么**:按 design §3.1 修改 `_record_probe_round_impl` 签名与方法体:

1. 签名加第三个业务参数 `confirmation_heard: bool`(放最后,保持 `probe_question` / `probe_respondent_answer` 顺序不变,降低对未来 dynamic_tool_creation 内调用方的影响)。
2. **方法体首行**(在 `self._completed` / `_max_rounds` / `len(_rounds)` 检查之前)加入:
   ```python
   if not confirmation_heard:
       return PROBE_GATE_REJECTION
   ```
3. 其他检查链不动(`_completed` / `_max_rounds <= 0` / 上限保护 / 追加 round / 返回引导)。

**改/加**:`apps/agent/agent/interview/tasks/question.py`(改 `_record_probe_round_impl` 约 5 行)。

**验收**:
- `pnpm test:py` 仍绿(现有 Python 测试用例不直接调 `record_probe_round`;`tests/load/*pressure*.py` 用 SDK 字符串而非真调)。
- T5 / T6 测试在 Wave B 加上后,关键 confirmation gate 行为有断言覆盖。

---

### T4 `build_question_instructions` 同步指引(R3)

**做什么**:按 design §4 修改 `build_question_instructions(question: QuestionTaskConfig)`:

1. probe 段守卫从 `if probe is not None:` 改为 `if probe is not None and probe.maxRounds > 0:`(与 conditional registration 同步)。
2. 在原有 probe 段的 "- After each probe exchange, call record_probe_round with..." 一行后追加两行指引(按 design §4 文案):
   - "AND confirmation_heard=True."
   - "Set confirmation_heard=True ONLY after you have ACTUALLY voiced the probe..."(完整文案见 design §4)
3. 顺手把 `(无特定指引,自行判断如何深入。)` 中文 fallback 改成英文 `(no specific guidance — probe at your discretion)`,与 system prompt 主体语言一致。

**改/加**:`apps/agent/agent/interview/tasks/question.py::build_question_instructions`(改约 6 行)。

**验收**:
- `pnpm test:py` 仍绿。
- 手动 sanity:用 probe=deep / maxRounds=5 / instruction="" 的 question 调 `build_question_instructions` 看输出,新指引段存在;用 probeConfig=None 调,probe 段完全不出现;用 maxRounds=0 调,probe 段也不出现。

---

## Wave B — 测试覆盖(R4)

### T5 新建 `apps/agent/tests/test_question_task.py`

**做什么**:按 design §8.1 完整模板创建文件,包含 TC-1 ~ TC-7 用例。

文件头使用 `pytest.importorskip("livekit.agents")` gate,与 `tests/test_livekit_smoke.py` 同款形态(不装 realtime extra 时整文件被跳过)。

**改/加**:`apps/agent/tests/test_question_task.py`(新建 ~80 行)。

**验收**:
- `cd apps/agent && uv sync --extra realtime && uv run pytest tests/test_question_task.py -v` 7 个用例全绿。
- `cd apps/agent && uv sync && uv run pytest tests/test_question_task.py` 全部 skipped(无 realtime extra 时正确跳过,不报 ImportError)。

---

### T6 新建 `apps/agent/tests/properties/test_probe_tool_gate.py`

**做什么**:按 design §8.2 完整模板创建文件,含 P-FLOW-06 / P-FLOW-07 两条 property test。

依赖 `hypothesis`(项目 `apps/agent/pyproject.toml` 已含)。文件头同样 `pytest.importorskip("livekit.agents")` 跳过。

**改/加**:`apps/agent/tests/properties/test_probe_tool_gate.py`(新建 ~60 行)。

**验收**:
- `cd apps/agent && uv sync --extra realtime && uv run pytest tests/properties/test_probe_tool_gate.py -v` 两条 property test 全绿(hypothesis 默认 100 example,跑 ≤ 30 秒)。
- `pnpm test:py` 全套(从 root)依然全绿,新 property test 自动被纳入。

---

### T7 全套回归 verify

**做什么**:跑全套以确认没有意外副作用。

```bash
pnpm typecheck                                              # 跨包契约 + Python 都不动,应仍绿
pnpm -F @merism/contracts test                              # 不动,但跑一遍确认
pnpm test                                                   # workspace 全套 vitest
pnpm test:py                                                # 含新增 test_question_task + property test
pnpm scope-guard                                            # 不引入禁词
```

**验收**:全部命令 0 退出码。如 `scope-guard` 报 unrelated 失败(参 `interview-probe-task-hardening` 前一个 commit 的同款情况:`apps/web/lib/assistant/access-control.ts` 是 untracked 工作),在 PR 描述里 explicit disclose 并隔离。

---

## Wave C — 文档同步(R5)

### T8 `AGENTS.md` 备忘段

**做什么**:在 `AGENTS.md § "LiveKit Agent 关键代码点 (apps/agent/agent/interview/)"` 块内,`tasks/` 描述位置(目前 `tasks/question.py` 在 Section 列表里没有专门一行,但有泛指)追加一行:

```markdown
- `tasks/question.py::LiveKitQuestionTask` — `record_probe_round` 按 `question.probeConfig.maxRounds > 0` conditional 挂载(不挂时 LLM 看不到该 tool);`confirmation_heard: bool` 自报家门参数在 false 时拒绝记账。**改回静态装饰器或移除 confirmation 参数会破坏 P-FLOW-06 / P-FLOW-07 property test**。详 `.kiro/specs/interview-probe-task-hardening/`。
```

**改/加**:`AGENTS.md`(strReplace 1 处,加 ~3 行)。

**验收**:
- `grep -n 'P-FLOW-06\|P-FLOW-07\|interview-probe-task-hardening' AGENTS.md` 命中新加行。
- `pnpm scope-guard` 仍绿(新文案无禁词)。

---

### T9 `README.md § Sub-spec roadmap` 表追加

**做什么**:在 `README.md § Sub-spec roadmap` 表格尾部追加一行:

```markdown
| **interview-probe-task-hardening** ✅ | LiveKit `QuestionTask` conditional tool registration(`record_probe_round` 仅在 `probeConfig.maxRounds > 0` 时挂载)+ `confirmation_heard` self-reporting gate 防 LLM 乱记 probe round. 借鉴 LiveKit Agents Tool loop design(Focus the toolset + Gate critical actions). See `.kiro/specs/interview-probe-task-hardening/`. | foundation-setup, ai-interview-engine |
```

(状态 ✅ 表示 spec 已落地,代码同 PR;若分两 PR 推则保留 🚧 直到 Wave A+B 全部合并)。

**改/加**:`README.md`(strReplace 1 处,加 1 行)。

**验收**:`grep -n 'interview-probe-task-hardening' README.md` 命中新行。

---

### T10 最终 sanity

**做什么**:

1. `git diff --stat main..HEAD` 确认改动文件总数(预期):
   - `apps/agent/agent/interview/tasks/question.py`(1 改)
   - `apps/agent/tests/test_question_task.py`(1 加)
   - `apps/agent/tests/properties/test_probe_tool_gate.py`(1 加)
   - `AGENTS.md`(1 改)
   - `README.md`(1 改)
   - `.kiro/specs/interview-probe-task-hardening/{requirements,design,tasks}.md`(3 加)
2. 跑 PR 描述要求的 5 个 verify 命令(T7 列表)。
3. 写 conventional commit:`feat(agent/interview): conditional probe tool registration + confirmation gate`

**验收**:
- 改动文件总数 ≤ 8。
- T7 5 命令全部 0 退出。
- Commit message 符合 `AGENTS.md § Commits and Pull Requests` 规范(无 attribution / period / 大小写错)。

---

## 决定不做的(transparency)

对应 design §6 的"不引入"项,这里再次列在 tasks 表里以避免下次有人翻 tasks.md 时误以为是漏项:

| Not in scope | 不做的原因 | 何时再考虑 |
|---|---|---|
| Watchdog timeout(改进 3) | 需先用 Agents Console 观测真实"LLM 沉默"发生率 | 拿一周数据后开新 sub-spec |
| LiveKit conversational test(改进 4b) | 阻塞在 `MERISM_FAKE_PROVIDERS=1` 工厂未落地 | `ai-interview-engine/tasks.md::L1` 落地后,补到 `apps/agent/tests/test_question_task_e2e.py`(新文件)|
| Tool name 改名(`confirm_and_record_probe`) | 会破坏 `tests/load/*pressure*.py` 字面量 | 永远不改名 |
| 改 contracts 增加 `confirmationRequired` 字段 | 与 LLM 自报家门 pattern 设计冲突;contract 字段是为消费者写,不为 LLM 行为写 | 永远不做(`scope.md` borrow-or-build:已有 artifact 服务该用途) |
