# Qwen Visual Analysis — Tasks

按 wave 推进,wave 内任务可并行,wave 间严格依赖。每个任务都列出
**做什么 / 改/加哪些文件 / 完成验收(命令或测试)** 三段。

---

## Wave 0 — 决策定锚(同一 PR,先于一切代码)

### T0.1 ADR-0010

- 写 `docs/adr/0010-qwen-visual-analysis.md`,Status=Accepted,
  Supersedes ADR-0004 (provider)、ADR-0005 §D2(file lifecycle)。
- 内容覆盖 R7 验收清单(provider 选型 / A 方案 / Python 形态 / 安全
  / 限流 / future-work)。
- 同 PR 给 ADR-0004 加 `Status: Superseded by ADR-0010` 头。
- 同 PR 给 ADR-0005 §D2 加 superseded 注。
- 验收:`grep -l "Superseded by ADR-0010" docs/adr/{0004,0005}-*.md`
  双命中。

### T0.3 Python Function 形态冒烟(belt-and-suspenders)

诚实背景:本仓库 13 个 Function 全 TS,Python Function 零先例。Appwrite
1.6 + `openruntimes/python:v4-3.12` 镜像已验证存在 + entrypoint 契约从
镜像源码确认,但**没有真的部署过一个 Python Function**。Wave 2 开干
前先做最小冒烟,避免 Wave 2 写到一半发现部署/触发链断了。

- 创建 `scripts/poc-python-function/` 目录:`src/main.py` 写
  `def main(context): return context.res.json({"ok": True, "ping":
  context.req.body or {}})`,`requirements.txt` 空文件即可。
- 在本地 stack 注册一个 `pythonHello` Appwrite Function(可手动 console
  或脚本),runtime=python-3.12,entrypoint=`src/main.py`,timeout=30s。
- 用 TS Appwrite SDK 跑一次 `createExecution("pythonHello",
  JSON.stringify({hello:"world"}), false)`,断言 response body 含
  `{"ok": true, "ping": {"hello": "world"}}`。
- 同时跑一次 `createExecution(..., true)` async,断言 200 立即返回 +
  Appwrite console 看到 execution row 状态从 `processing → completed`。
- 如果失败:STOP,先解决 Python runtime 问题再开 Wave 2。
- 如果成功:删 `scripts/poc-python-function/`,在 ADR-0010 里加一句
  "Python Function smoke verified <date>"。
- 验收:在 ADR-0010 §implementation-notes 记 hello-world 冒烟通过的
  日期 + execution id。

### T0.2 Steering / 词表更新

- `errors-and-observability.md::Feature flags` 加
  `QWEN_VISUAL_ANALYSIS_ENABLED`,标 `GEMINI_VISUAL_ANALYSIS_ENABLED`
  deprecated。
- `errors-and-observability.md::Wave B 接入清单` 加
  `apps/functions/analyzeSessionVisual/src/qwen_video.py::analyze_oss_video`
  → scope `function.analyzeSessionVisual.qwen.analyze`。
- `architecture.md::Where new things go` 加一行:Function 用 Python +
  dashscope SDK 自动 oss 托管的形态,作为 ADR-0010 的落地形状。
- 验收:`pnpm scope-guard` 仍绿;steering 改动在 PR 描述里点名。

---

## Wave 1 — 契约 / schema deprecation(可与 Wave 0 同 PR)

### T1.1 `packages/contracts` 注解 + 字段 deprecation

- `src/api.ts::VisualAnalysisOutputSchema` 给 `segments` /
  `keyMoments` 加 JSDoc(per design §契约形状),不改 schema 本身。
- `src/entities.ts::VisualAnalysisJobSchema` 给 `geminiFileName` /
  `geminiUploadedAt` 加 `@deprecated` JSDoc。
- 加 `tests/contracts.test.ts` 一个用例:确认 `VisualAnalysisOutput`
  的 minimal payload + 单段 segments + 模型推断 keyMoments 通过 parse。
- 验收:`pnpm -F @merism/contracts test && pnpm -F @merism/contracts typecheck`。

### T1.2 `packages/appwrite-schema` 同步 deprecation

- 给 `visual_analysis_jobs` 的 `geminiFileName` / `geminiUploadedAt`
  attribute 加注释 `// @deprecated removed in qwen-visual-analysis-cleanup`。
- 字段保留 `nullable: true`,**不**这次 PR 删除(避免和正在飞的
  Gemini 路径打架)。
- 验收:`pnpm schema:apply && pnpm schema:verify` 对 local stack 无 diff。

---

## Wave 2 — Python Function 骨架(在 TS 版仍存活的前提下并行搭建)

### T2.1 创建 Python Function 目录

- `apps/functions/analyzeSessionVisual_py/`(临时名,Wave 4 切换后改回
  `analyzeSessionVisual`)。
- `pyproject.toml` 声明依赖 `dashscope>=1.25.23, openai>=2.0, appwrite>=11,
  hypothesis>=6, pytest>=8`。
- `src/{__init__.py, main.py, handler.py, deps.py, qwen_video.py,
  claim.py, visual_analysis.py}` 占位 + docstring。
- `src/prompts/__init__.py + visual_analysis.py` prompt 模板。
- Function 注册元数据(Appwrite Function spec):runtime=python-3.12,
  entrypoint=`src/main.py`,timeout=900s。
- 验收:`cd apps/functions/analyzeSessionVisual_py && python -m
  py_compile $(find src -name '*.py')` 通过。

### T2.2 晋升 POC 封装层

- `cp scripts/poc-qwen-omni-video/qwen_video.py
  apps/functions/analyzeSessionVisual_py/src/qwen_video.py`。
- 把 POC 里 mask_secret / Logger / with_retry 几个本地副本**移除**,
  改 import `from observability_py import create_logger, mask_secret,
  with_retry, TransientProviderError, PermanentProviderError`(包定义
  见 T2.5,T2.2 依赖 T2.5 完成)。理由:Function 容器跟 `apps/agent`
  worker 容器是不同部署,没法直接 mount `apps/agent/agent`,所以必须
  抽包共享 — 这是 binding 决策,不是可选优化。
- 加 `normalize_output(...)` 函数,实现 design §clamp 逻辑。
- 验收:`pytest apps/functions/analyzeSessionVisual_py/tests/test_qwen_video.py`
  绿(把 POC 的 `test_qwen_video.py` 迁过来 + 加 normalize_output
  单测)。

### T2.3 翻译 `claim.ts` → `claim.py`

- 逐行翻译 `decideClaim` 的 5 个 case + `apply_claim`。
- `tests/test_claim.py` 镜像 `claim.test.ts` 的所有 case + hypothesis
  property:任意 `(existing, now_ms, attempt_cap, stuck_after_ms)` 输入
  得到的 decision.action ∈ 合法集合。
- 验收:`pytest tests/test_claim.py` 绿;case 数量 ≥ 现有 TS 版本。

### T2.4 翻译 `handler.ts` → `handler.py`

- pure core:7 步流程(claim → fetch session → fetch recording →
  fetch transcript → fetch bytes → analyze → patch report → mark
  succeeded)。
- 错误路径:7 步任一失败 → `set_job_status("failed", errorContext)` +
  返回 `{status: 200, body: {ok: false, error: "..."}}`(异步 job 不
  抛 5xx)。
- `Deps` Protocol 定义所有外部副作用(`find_job_context` /
  `claim_job` / `find_recording` / `find_transcript` /
  `get_recording_bytes` / `analyze_recording_visuals` /
  `set_job_status` / `patch_report_visual_analysis`)。
- `tests/test_handler.py` 用 in-memory fake deps 跑全 7 步 happy path
  + 每一步注入 PermanentProviderError / TransientProviderError 各一次。
- 验收:`pytest tests/test_handler.py -v` 全绿;
  `coverage report tests/test_handler.py` 对 `handler.py` 100% 覆盖。

### T2.5 抽 `packages/observability-py`(binding,T2.2 依赖此包)

- 新包 `packages/observability-py/observability_py/__init__.py`,导出
  `create_logger / mask_secret / with_retry / TransientProviderError /
  PermanentProviderError`。
- 内容直接搬 `apps/agent/agent/logging.py + retry.py`,行为不变。
- `apps/agent/agent/{logging,retry}.py` 改成 `from observability_py
  import ...` 的 re-export shim,**不**直接删,避免破坏 agent 现有
  import。
- `apps/functions/analyzeSessionVisual_py` 在 pyproject 里依赖此包。
- 验收:`pnpm test:py` 全绿(agent 既有测试 + 新 Function 测试都用同
  一套 primitives)。

### T2.6 `deps.py` 装配真实依赖

- 装 Appwrite Server SDK(`from appwrite.client import Client` 等)。
- 装 OpenAI client(指向 `compatible-mode/v1`)。
- `qwen_video` 注入到 Deps 的 `analyze_recording_visuals`。
- `recording bytes` 通过 Appwrite Storage `get_file_download` 取。
- `patch_report_visual_analysis`:读 `analysis_reports/<sessionId>` 的
  `insights` JSON bucket,merge `visualAnalysis` 字段后写回(对齐既有
  TS deps 行为)。
- 验收:`pytest tests/test_deps.py`(in-memory Appwrite stub +
  recorded HTTP via responses lib)绿。

### T2.7 `main.py` Function 入口 + `withErrorBoundary` 等价壳

- `def main(context):` 读 env、construct deps、call handler、map
  result 到 Appwrite Function res。
- 任何 uncaught 异常 → log error with stack + traceId,return
  `{status:500, body:{ok:false, error:"internal_error", traceId}}`。
- 启动期校验:`DASHSCOPE_API_KEY` / `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID`
  / `APPWRITE_API_KEY` 缺一即 raise(R1)。
- 验收:`python -c "from src.main import main; ..."` smoke 启动期校验
  分支跑得通。

---

## Wave 3 — Property tests + Live tests(必须随 Function 一起 ship)

### T3.1 Property tests

- `tests/properties/test_clamp.py`:hypothesis 生成任意
  `{timestampMs, label, description}` list,`normalize_moments(items,
  duration_ms)` 后所有 timestampMs ∈ `[0, duration_ms]` 且为有限数。
- `tests/properties/test_classify.py`:hypothesis 生成任意 error
  message,`_classify(Exception(msg))` 返回 ∈
  `{TransientProviderError, PermanentProviderError}`,不抛其他。
- `tests/properties/test_concurrent_claim.py`:N(2..16)个并发
  `apply_claim` 同 sessionId,**仅一个**得到 `claimed=True`。
- `tests/properties/test_secret_leak.py`:任意调用路径(含主动
  `raise Exception(api_key)`)的日志 stream 不含完整 `sk-...` API key
  字面量;`mask_secret(key)` 输出形如 `^sk-\w{1,4}\*\*\*$`。
- `tests/properties/test_schema_roundtrip.py`:hypothesis 生成 valid
  `VisualAnalysisOutput` 字段组合,Python pydantic 镜像 round-trip
  idempotent(若 Wave 2 抽 pydantic mirror;否则 JSON round-trip)。
- 验收:`pytest tests/properties/ -v --hypothesis-show-statistics`
  全绿,每个 property 至少 100 examples。

### T3.2 Live tests(MERISM_LIVE_TESTS=1)

- `tests/qwen_live.py`:迁 POC 的 `test_qwen_video.py` 4 个用例。
- 加 oversize / over-duration 用例(伪造 `recording.bytes`/`durationMs`
  超界,断言 PermanentProviderError + 正确 errorContext.reason)。
- 默认 `pytest` 跳过(`@pytest.mark.skipif(os.environ.get(
  "MERISM_LIVE_TESTS") != "1")`)。
- 验收:本机 `MERISM_LIVE_TESTS=1 DASHSCOPE_API_KEY=$KEY pytest
  tests/qwen_live.py -v` 全绿。

---

## Wave 4 — 切换 + 清理(在 Wave 2/3 全绿后单独 PR)

### T4.1 重命名 + Function 重建 + id 同步

- `git rm -r apps/functions/analyzeSessionVisual`(旧 TS 整目录删除,
  含 `dist/` / `node_modules/`)。
- `git mv apps/functions/analyzeSessionVisual_py
  apps/functions/analyzeSessionVisual`(`git` 自动识别 rename)。
- **Appwrite Function id 处理(诚实记录:此点未实测)**:Appwrite
  `appwrite.json` 里 Function 的 `runtime` 字段改 `python-3.12`。Appwrite
  1.6 是否支持 in-place runtime 切换不确定。两条预案:
  1. **能切换**:`pnpm schema:apply` 自动应用 runtime 变更,Function id
     不变,`.env` 的 `ANALYZE_SESSION_VISUAL_FUNCTION_ID` 不动 — 最优。
  2. **不能切换、必须删建**:同 PR 内 (a) `appwrite functions delete
     analyzeSessionVisual` (b) `appwrite functions create` 创建 python
     版本拿到新 id (c) 更新 `.env` + `.env.example` 的
     `ANALYZE_SESSION_VISUAL_FUNCTION_ID` 到新 id (d) 验证
     `analyzeSession` 重启后读到新 id。
  Wave 0 T0.3 的 hello-world 冒烟同步验证哪条路径成立,Wave 4 实施时
  按结果走对应预案。
- 验收:`grep -RIn '@google/genai\|gemini-3-flash\|gemini-2.5-flash'
  apps/ packages/` 空命中。

### T4.2 删 sweepGeminiFiles

- `git rm -r apps/functions/sweepGeminiFiles`。
- 删 `analyzeSession/deps.ts` 里 `createVisualAnalysisJob` 写
  `geminiFileName: null` 那两个字段(deprecation 期不再写)。
- 删 `infra/docker/.../sweep schedule`(若有 cron 注册)。
- 验收:`grep -RIn 'sweepGeminiFiles\|sweep_gemini' apps/ packages/
  infra/ docs/` 空命中(除 ADR/spec 历史引用)。

### T4.3 env / docs 清理

- `.env.example` 删 `GEMINI_VISUAL_*` 行,加 `QWEN_VISUAL_ANALYSIS_ENABLED
  / QWEN_VISUAL_MODEL / QWEN_VISUAL_MAX_BYTES`。
- `.env`(本机)同步(开发者手工,不入 git)。
- `AGENTS.md` 的 "Repository Map" 更新 `analyzeSessionVisual`
  描述(node→python)。
- `errors-and-observability.md::Feature flags` 表移除
  `GEMINI_VISUAL_ANALYSIS_ENABLED`(deprecation 期已过)。
- 验收:`grep -RIn 'GEMINI_VISUAL\|GEMINI_API_KEY' apps/ packages/
  infra/ .env.example` 空命中。

### T4.4 POC 文件夹清理

- `git rm -r scripts/poc-qwen-omni-video`(封装层已晋升,POC 完成
  使命)。
- 同 PR 在 ADR-0010 里加一句指向 git history `<sha>` 作为 POC 来源
  痕迹。
- 验收:`scripts/poc-qwen-omni-video` 不存在。

---

## Wave 5 — 真实端到端 staging 验证(非 PR-blocking,但 ship 前必须做)

### T5.1 Local stack 端到端

- `pnpm stack:up && pnpm schema:apply`。
- 以 `researcher@merism.local` 跑一次完整访谈 → recording → 触发
  `analyzeSession` → 自动 enqueue `analyzeSessionVisual`(Python)。
- 通过 Appwrite console 看 `visual_analysis_jobs/vis_<sessionId>` 走
  `queued → analyzing → succeeded`,`analysis_reports.<sessionId>.insights.
  visualAnalysis` 被 patch。
- 在 `/studies/[id]` 打开会话,确认 `VisualAnalysisPanel` 显示
  summary + keyMoments,点 keyMoment 跳到大致时间(模型级精度 OK)。
- 在 survey 报告页打开,确认 `VisualRollupSection` 显示受挫度 / outcome
  分布(对齐 `aggregate-visual.ts`)。
- 验收:截 3 张图 + Function execution 日志贴 PR 描述。

### T5.2 模型级精度抽样

- 选 3 个真实 session(短 < 5min / 中 5–15min / 长 > 15min)。
- 对比 keyMoments[].timestampMs vs 录像实际事件时间,记录漂移。
- 漂移阈值 = `min(录像总长 1%, 10s)`(对齐 design §已知 trade-off)。
  漂移占比 > 30% → 触发 follow-up 决策
  (要不要立即启动 B 方案 sub-spec)。
- 验收:在 ADR-0010 末尾追一节 "real-world precision sample" 记录
  3 个 session 的漂移数据。

---

## 任务依赖图(简化)

```
Wave 0 (ADRs + steering)
     │
     ▼
Wave 1 (contracts/schema deprecation) ── Wave 2 (Python Function 骨架)
                                              │
                                              ▼
                                         Wave 3 (property + live tests)
                                              │
                                              ▼
                                         Wave 4 (cutover + cleanup)
                                              │
                                              ▼
                                         Wave 5 (staging 验证)
```

Wave 0 必须在第一个 PR;Wave 1 可与 Wave 0 同 PR(它们都不破坏现有
Gemini 路径)。Wave 2/3 在第二个 PR(新 Function 与旧 Function 并存)。
Wave 4 在第三个 PR(原子切换 + 旧物清理)。Wave 5 在 Wave 4 ship 后,
不卡 merge。

---

## 不在本 sprint 的后续 sub-spec

- `qwen-visual-analysis-cleanup`:删 `geminiFileName` /
  `geminiUploadedAt` attributes(等 deprecation 一个 cycle 后)。
- `qwen-visual-analysis-segmented`:B 方案 ffmpeg 切片,精确 keyMoments
  (仅当 T5.2 漂移数据触发时立项)。
- `transcript-correction`:Omni 复看视频音频校正实时 ASR 错漏(独立
  spec,先实测可行性)。
- `qwen-visual-self-hosted-oss`:撞 100 QPS 限流时切自建阿里云 OSS +
  presigned URL(单租户当下不需要)。
