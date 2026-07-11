# Qwen Visual Analysis — Requirements

## 背景

`analyzeSessionVisual` 当前用 **Google Gemini Files API** 对完成访谈的整段
录像做事后视觉分析（ADR-0004 / ADR-0005）。该路径依赖三个 Gemini 独有
机制：

1. `files.upload()` 把整段视频上传一次得到 `fileUri`
2. 同一 `fileUri` 配合 `videoMetadata: {startOffset, endOffset}` 让模型
   只看某个时间窗（offset 切片）
3. `files.delete()` + `sweepGeminiFiles` 孤儿文件 GC

本 spec 把视觉分析的 provider 换成 **Qwen3.5-Omni（DashScope）**，
理由：与项目既有 Qwen ASR/TTS provider 共享 key/计费、与 ADR-0007 的
Gemini Live 替换方向（中国侧 provider 收敛）一致、Gemini 长期可达性
不可控。

**只借形态、拒绝实现** ——

- ✅ 借 Gemini 路径既有的"上传 → 分析 → 清理"三段式 + `withRetry` /
  `withErrorBoundary` / `withLLMCall` 观测壳
- ✅ 借 PostHog `session_summary` 的 partial-result（部分段失败仍出报告）
  思路 —— 在 A 方案下退化成"整段失败=任务失败"，简化容错
- ❌ 拒：第二个 LLM provider（DeepSeek 仍是文本，Qwen 在视觉/ASR/TTS）—
  本 spec 是把 Qwen 角色从 ASR/TTS 扩到视觉 LLM，须新 ADR 论证
- ❌ 拒：自建 OSS / 把 Appwrite Storage 暴露公网（实测确认 dashscope
  SDK 自带临时 oss 托管，无需额外存储基建）
- ❌ 拒：ffmpeg 切片（A 方案不需要；保留作 future B 方案的 spec）
- ❌ 拒：`base64` 直传（10MB 上限，真实录像不可用）
- ❌ 拒：transcript 校正（独立功能，单独 sub-spec）

## 范围

### 包含

- 用 `dashscope` Python SDK 封装的薄 provider 模块替换现有 Gemini 模块。
  封装层职责：`upload_local_video()` + `analyze_video()`，仅此二个公开
  入口，分类 Transient/Permanent 错误。
- `analyzeSessionVisual` Function **从 TS 迁移到 Python**（`apps/agent`
  栈复用），保留契约 / 触发机制 / job 行 / 并发 claim 不变。
- 现有 `VisualAnalysisOutput` 契约**几乎不变**：仅放宽 `segments[]` 取值
  策略（来自模型整段输出而非 offset 切片，加 clamp 校验）；其余字段
  （summary / sentiment / frustrationScore / outcome / tags / keyMoments）
  全部保留，下游消费者零感知。
- `keyMoments[]` 由 Qwen-Omni 在整段分析里**结构化输出**（每个 moment
  带 `timestampMs` / label / description），加 clamp 防幻觉（超出
  `durationMs` 的丢弃 / 夹回区间）。
- 删除：`apps/functions/sweepGeminiFiles/` 整个 Function、
  `visual_analysis_jobs.geminiFileName` / `geminiUploadedAt` 字段、
  `analyzeSessionVisual` 的 `onUploadStarted` 回调链路。
- 加：`QWEN_VISUAL_*` 环境变量（model / max_bytes / api_key 复用
  `DASHSCOPE_API_KEY`），`GEMINI_VISUAL_*` 标记 deprecated 一个 sub-spec
  cycle 后删。
- ADR-0010：将 Qwen 角色扩到视觉 LLM；取代 ADR-0004（provider）和
  ADR-0005 D2（Gemini 文件生命周期）。ADR-0005 D1（独立异步 Function）
  / D3（409 CAS 并发去重）保留。
- 单元 + property 测试：契约 clamp / Transient/Permanent 分类 / 并发
  claim / partial-failure rollback / secret leakage。

### 排除

- B 方案（ffmpeg 逐段切片精确 keyMoments）—— 留下个 sub-spec
  `qwen-visual-analysis-segmented`。当前 A 方案的 keyMoments 来自模型
  整段推断，精度为模型级。
- transcript 校正（用 Omni 复看视频校正实时 ASR 错漏）—— 独立 sub-spec
  `transcript-correction`，先实测可行性再立案。
- 视频内容向量化检索（`MultiModalEmbedding` 支持视频 fps + max_video_frames）
  —— 跟知识库相关，独立 sub-spec。
- 事后录音文件转写（`Transcription.async_call`）—— 独立 sub-spec。
- 实时访谈期视觉理解（取帧→Qwen-VL 描述）—— 已由 ADR-0004 §realtime 治理，
  不在本 spec。
- TS 内 `fetch` 手动复刻 SDK 上传逻辑 —— 上一轮讨论已比较，封装 SDK +
  Python Function 形态更优；此选项不再保留。


## Requirements

### R1: Provider 替换边界 (binding)

`analyzeSessionVisual` 视觉分析的**全部模型调用**走 Qwen3.5-Omni
（DashScope），不再调用 `@google/genai`、不再访问
`generativelanguage.googleapis.com`。

#### 验收标准

- WHEN `analyzeSessionVisual` 处理一个 session 录像 SHALL 通过
  `dashscope.utils.oss_utils.upload_file` 上传到百炼临时 oss 空间，调用
  `qwen3.5-omni-plus` 完成分析。
- IF Function 配置缺失 `DASHSCOPE_API_KEY` THEN SHALL 在 `main.py` 启动期
  抛 `PermanentProviderError("DASHSCOPE_API_KEY required")`，不进入
  handler。
- 仓库内 `apps/functions/analyzeSessionVisual/`、`apps/functions/
  sweepGeminiFiles/`（删除前快照）以外**任何文件不得 import**
  `@google/genai` 用于 Function 视觉分析。
- 仓库内**没有**任何包含字面量 `generativelanguage.googleapis.com` 或
  `gemini-3` / `gemini-2.5-flash` 的视觉分析代码路径。
- `qwen3.5-omni-plus` 调用 SHALL 走 OpenAI 兼容端点
  `https://dashscope.aliyuncs.com/compatible-mode/v1`，必带
  `extra_headers={"X-DashScope-OssResourceResolve": "enable"}`，
  `stream=True` + `modalities=["text"]`（omni 在该端点的硬约束，已实测）。

### R2: VisualAnalysisOutput 契约兼容 (binding)

`VisualAnalysisOutputSchema`（`packages/contracts/src/api.ts`）作为公共
契约**保持向后兼容**：所有现有字段名/类型/可空性不变；下游消费者
（`analyzeSurvey/aggregate-visual.ts` / `visual-analysis-panel.tsx` /
`visual-rollup-section.tsx` / `lib/queries/reports.ts` / `lib/workspace/
data.ts`）零代码改动即可继续工作。

#### 验收标准

- WHEN Qwen 分析成功 SHALL 返回 `VisualAnalysisOutput` 满足
  `VisualAnalysisOutputSchema.parse(...)` 不报错，且 `source="recording"` /
  `recordingFileId` / `durationMs` / `visualConfirmation` / `summary` /
  `sentiment` / `tags` / `modelId="qwen3.5-omni-plus"` / `generatedAt`
  全部填齐。
- `segments[]` SHALL **退化为单段**：`[{id:"vseg_1", startMs:0,
  endMs:durationMs, title, description, observations, issueLevel,
  evidence:[]}]`。多段 offset 切片在 A 方案下不实现，但契约形状保留以兼容
  下游。
- `keyMoments[]` SHALL 由 Qwen 在结构化 prompt 下输出，每条 moment 含
  `timestampMs` / `label` / `description` / `id`。
- WHEN Qwen 输出的 `timestampMs > durationMs` 或 `< 0` 或非数字 SHALL
  被 clamp 到 `[0, durationMs]` 或丢弃（参考 `gemini/analyze-segment.ts:
  normalizeMoments` 既有逻辑）。
- WHEN Qwen 输出无法被 prompt schema 解析 SHALL 退化为
  `keyMoments=[]` + summary 仍写入 + `tags` 加
  `["consolidation_fallback"]`，不抛错（best-effort，文本报告已 ship）。

### R3: 并发 / 幂等 / 触发链路保留 (binding)

ADR-0005 D1（独立异步 Function）和 D3（`createDocument(id="vis_${sessionId}")`
+ 409 CAS）的并发模型**保持不变**。`analyzeSession` 通过
`ANALYZE_SESSION_VISUAL_FUNCTION_ID` 触发的链路不动。

#### 验收标准

- WHEN N 个并发执行同时处理同一 sessionId SHALL 仅一个写入
  `visual_analysis_jobs/vis_${sessionId}` 并真正调用 Qwen，其余在
  Appwrite 409 上退出（既有 `claim.ts` / `decideClaim` 逻辑直接迁
  Python，等价行为）。
- WHEN `attemptCount >= MAX_VISUAL_ANALYSIS_ATTEMPTS` SHALL 永久失败
  并写 `errorContext={reason:"permanent_max_attempts", classifier:"claim"}`(与 design §错误分类表的 `permanent_*` 词表对齐)。
- `analyzeSession`（TS）的 `enqueueVisualAnalysis` + `createVisualAnalysisJob`
  Deps 接口 SHALL 保持签名不变；只切换被触发的 Function id 仍是
  `ANALYZE_SESSION_VISUAL_FUNCTION_ID`。
- WHEN 异步 enqueue 失败 SHALL **不**让文本分析失败（best-effort 语义
  保留，跟 ADR-0005 D1 一致）。

### R4: Durability 简化 (binding)

Qwen 临时 oss 由百炼负责 48 小时自动销毁，且 SDK 自动管理上传句柄。
我们不再持有"长效文件 handle"，因此删除现有 Gemini 文件生命周期机制。

#### 验收标准

- `apps/functions/sweepGeminiFiles/` 整个 Function（含 `main.ts` /
  `handler.ts` / `deps.ts` / tests）SHALL 在本 spec 实施完成时被删除。
- `visual_analysis_jobs` collection 的 `geminiFileName` /
  `geminiUploadedAt` 字段 SHALL 走 deprecation：先标 deprecated 注释
  + 不再写入；下一个 sub-spec cycle 后从
  `packages/appwrite-schema/src/schema.ts` 移除并 `pnpm schema:apply`。
- `VisualAnalysisJobSchema`（contracts）的 `geminiFileName` /
  `geminiUploadedAt` 字段 SHALL 加 `@deprecated` JSDoc 一个 sub-spec
  cycle 后删除。
- 本 spec **不**新增任何"清理 Qwen 临时文件"的代码（百炼自动 GC）。
  ADR-0005 §D2（Gemini 文件 GC）SHALL 在 ADR-0010 中标记为已被本 spec
  取代。

### R5: 观测 / 错误分类 / Secret masking (binding)

封装层 SHALL 套进项目既有观测壳：`agent.logging.create_logger` +
`agent.retry.with_retry` + `TransientProviderError` /
`PermanentProviderError`。视觉 LLM 调用 SHALL 走 `withLLMCall` 等价
（Python 侧）记录 `LLMCallEvent`，scope = `function.analyzeSessionVisual.qwen`。

#### 验收标准

- WHEN 上传/分析任一步抛 `BadRequest` / `access denied` / `auth` /
  `file too large` / `unsupported` SHALL 分类为 `PermanentProviderError`，
  with_retry 不重试，job 写
  `errorContext={reason:"permanent_<class>", classifier:"<marker>"}(class 取自 design §错误分类表:auth/request/oversize/input_missing/max_attempts)`。
- WHEN 抛 `429` / `5xx` / `timeout` / `throttling` / `download failed`
  / `temporary` SHALL 分类为 `TransientProviderError`，with_retry 最多 3
  次（与 Gemini 路径一致），用尽后写
  `errorContext={reason:"transient_exhausted", classifier:"<marker>"}(marker 取自 design §错误分类表:rate_limit/timeout/5xx/unknown)`。
- 任一日志行（含 traceback）SHALL **不**包含 `DASHSCOPE_API_KEY` /
  `QWEN_API_KEY` 完整值；调用点用 `mask_secret(api_key)` 输出
  `sk-7***` 形式。
- LLM 调用 SHALL 记录至少一条 `info` 日志，含 `traceId` / `scope=
  function.analyzeSessionVisual.qwen` / `model="qwen3.5-omni-plus"` /
  `oss_scheme=true` / `chars=<output_len>`。
- `errors-and-observability.md::Wave B 接入清单` SHALL 在同 PR 中加一行：
  `apps/functions/analyzeSessionVisual/src/qwen_video.py::analyze_oss_video` →
  scope `function.analyzeSessionVisual.qwen.analyze`。

### R6: Function 语言迁移 TS → Python (binding)

**调研事实(已实测)**:本仓库 `apps/functions/` 当前 13 个 Function 全部
TS,无 Python 先例。但 `openruntimes/python:v4-3.12` 镜像已经在本机
stack 拉取存在(`docker images | grep openruntimes/python`),Appwrite 1.6 +
openruntimes 0.6.11 原生支持。Function entrypoint 契约已从镜像
`/usr/local/server/src/server.py` 源码确认:`async def main(context)` /
`def main(context)`,`context.req` / `context.res.json(obj, status, headers)`,
依赖通过代码根 `requirements.txt` 自动 `pip install`。这跟本 spec 假设
完全兼容,无需改方案;但 Wave 0 仍需一个 Hello-world 部署确认 stack
配置无误(见 tasks.md T0.3)。


`analyzeSessionVisual` 的运行时形态从 Appwrite **node** runtime 迁到
**python-3.12**（与 `apps/agent` 同栈），以便直接使用 `dashscope` SDK
的 `file://` 自动 oss 托管能力。

#### 验收标准

- `apps/functions/analyzeSessionVisual/` 重组为 Python Function：
  `src/main.py`（SDK wrapper / Appwrite res 适配）+
  `src/handler.py`（pure core,接 `Deps` Protocol）+
  `src/deps.py`（real deps,SDK 装配）+
  `src/qwen_video.py`（封装层,从 `scripts/poc-qwen-omni-video/qwen_video.py`
  晋升而来）+
  `src/claim.py`（从 TS 翻译过来,行为等价）+
  `src/visual_analysis.py`（数据类 / 轻量 schema 镜像）。
- `pyproject.toml` SHALL 声明依赖 `dashscope>=1.25` + `openai>=2.0` +
  `appwrite>=11`,不依赖 `--extra realtime`。
- WHEN `pnpm test:py` 运行 SHALL 包含本 Function 的 unit + property
  测试,通过率 100%。
- TS 侧的 `apps/functions/analyzeSessionVisual/` 在 R6 完成时被删除
  (含 `dist/` / `tests/` / `package.json` / `tsconfig.json` /
  `tsup.config.ts`),不留过渡 stub。
- `analyzeSession`(仍是 TS)调用方式不变:仍通过 Appwrite Functions
  API 第 3 位参 `async=true` 不变（TS `createExecution(id, body, true)`）；function id =
  `process.env.ANALYZE_SESSION_VISUAL_FUNCTION_ID`。被触发函数底层是
  Python 还是 Node 对调用方透明。

### R7: Provider 角色扩张需 ADR (binding)

Qwen 在本仓库的角色历史上限定为 ASR/TTS（参 `architecture.md::
Globally forbidden` "第二个 ASR/TTS provider 之外、Qwen 仅限 ASR/TTS"
精神,虽未字面化但属于 ADR-0004 的反向锁)。本 spec 把 Qwen 扩到
**事后视觉分析 LLM**,**必须**有 ADR 论证并取代 ADR-0004。

#### 验收标准

- ADR-0010 SHALL 在本 spec 第一个 PR 中创建,文件名
  `docs/adr/0010-qwen-visual-analysis.md`,Status 为 Accepted,
  显式声明 "Supersedes ADR-0004 (provider locked to Gemini)
  and ADR-0005 §D2 (Gemini file lifecycle)"。
- ADR-0004 SHALL 在同 PR 中加 `Status: Superseded by ADR-0010` 头。
- ADR-0005 SHALL 在同 PR 中加注:`§D1 / §D3 retained, §D2
  superseded by ADR-0010 (no long-lived file handle in the Qwen path)`。
- ADR-0010 SHALL 至少回答:provider 选型(为什么 Qwen3.5-Omni 而不是
  qwen-vl-max)/ 切片策略(为什么 A 不 B)/ Function 语言(为什么 Python
  而不是 TS+SDK 子进程)/ 安全(无录像公网窗口的论证)/ 限流(单租户
  并发不会撞 100 QPS)。

### R8: Scope guard 词表更新 (binding)

`pnpm scope-guard` 的字面量黑名单 SHALL 加 `gemini` 类项的反向豁免、
并加 `qwen3.5-omni` / `dashscope-instant` 等本 spec 引入的合法字面量
说明。

#### 验收标准

- WHEN `pnpm scope-guard` 在 R6 完成后运行 SHALL 不命中任何残留
  `@google/genai` / `gemini-3-flash` / `gemini-2.5-flash` 字面量(应已
  全部移除)。
- WHEN scope-guard 的 ignore 列表里有 `apps/functions/sweepGeminiFiles`
  类条目 SHALL 在同 PR 中清理,避免误导后人以为该路径还存在。

### R9: 配置 / 环境变量 (binding)

#### 验收标准

- `.env.example` SHALL 加:
  ```
  # Visual analysis (Qwen3.5-Omni via DashScope)
  QWEN_VISUAL_ANALYSIS_ENABLED=false
  # DASHSCOPE_API_KEY 复用现有 Qwen ASR/TTS key,不再单独定义
  QWEN_VISUAL_MODEL=qwen3.5-omni-plus
  QWEN_VISUAL_MAX_BYTES=2147483648
  ```
- `.env.example` 中现有 `GEMINI_VISUAL_*` 项 SHALL 标 deprecated 注释,
  注明取代它们的 `QWEN_VISUAL_*` 项,并在 R4 同窗口删除。
- `errors-and-observability.md::Feature flags / env toggles` 表
  SHALL 同 PR 加 `QWEN_VISUAL_ANALYSIS_ENABLED`(严格 `"1"` 启用),
  并把 `GEMINI_VISUAL_ANALYSIS_ENABLED` 标 deprecated。
- WHEN `QWEN_VISUAL_ANALYSIS_ENABLED != "1"` SHALL `analyzeSession` 的
  `enqueueVisualAnalysis` Deps **不被装配**,该 session 只产出文本报告
  (跟 Gemini 时代行为一致,feature off-by-default)。

### R10: 视频体积 / 时长边界 (binding)

DashScope 文档化的 Qwen-Omni 视频上限:**单视频 ≤ 1 小时 / ≤ 2GB**(已在
spec 上下文核实)。本 Function 必须在调用前拒绝越界输入。

#### 验收标准

- WHEN `recording.bytes > QWEN_VISUAL_MAX_BYTES`(默认 2GB) SHALL 在
  上传前抛 `PermanentProviderError("video exceeds max_bytes")`,
  job 写 `errorContext.reason="oversize_bytes"`。
- WHEN `recording.durationMs > 60 * 60 * 1000`(1 小时) SHALL 抛
  `PermanentProviderError("video exceeds max_duration")`,
  job 写 `errorContext.reason="oversize_duration"`。
- WHEN `recording.bytes == 0` SHALL 抛 `PermanentProviderError(
  "video bytes are empty")`(对齐既有 Gemini 路径行为)。

## Property tests(必须存在)

新增 / 改造,放在 `apps/functions/analyzeSessionVisual/tests/properties/`
(Python `hypothesis`):

| Property | 描述 |
|---|---|
| `keyMoments` clamp | 任意模型输出的 `timestampMs` 经 clamp 后 ∈ [0, durationMs] 且为有限数 |
| schema round-trip | `VisualAnalysisOutputSchema.parse(parse(x))` idempotent |
| 并发 claim | N 个并发 `claim_job(sessionId)` 仅一个返回 `claimed=True`(行为镜像 TS 现状) |
| transient/permanent 分类 | 任意 `errors-and-observability::error code` 关键字串 经 `_classify` 后 ∈ {Transient, Permanent},不抛其他 |
| secret leakage | 任意触发路径的日志输出 SHALL 不含完整 `sk-` API key |

## 出范围(明确写下,避免 scope drift)

以下需求**本 spec 不做**,各自独立的 sub-spec 或 ADR:

- transcript 校正(Omni 复看视频音频校正实时 ASR 错漏)→
  `transcript-correction` sub-spec(立项前先实测)。
- 精确 keyMoments / 多段 segments(B 方案,ffmpeg 切片)→
  `qwen-visual-analysis-segmented` sub-spec。需要时先证明产品价值
  (keyMoments 跳播放精度模型级不够用),再做。
- 视频内容向量化检索(`MultiModalEmbedding` 视频 fps + max_video_frames)
  → 跟知识库相关,独立 sub-spec。
- 录音文件事后转写(`Transcription.async_call`)→ 独立 sub-spec。
- 实时访谈期视觉理解 → 已由 ADR-0004 §realtime 治理(Qwen-VL 单帧
  描述已是该 spec 的 provider),不动。
