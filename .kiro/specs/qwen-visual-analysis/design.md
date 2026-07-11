# Qwen Visual Analysis — Design

## 投资前调研结论(已实测,作为本 design 的事实基础)

- **`files.create(purpose="multimodal")` 不存在**:DashScope OpenAI 兼容
  端点的 `purpose` 仅接受 `['file-extract', 'batch']`,且 file-extract
  返回 `file-fe-...` id 不带 `url` 字段。第三方 AI 教程描述的此机制
  已证伪,本 design **不依赖**它。
- **DashScope SDK 自带 oss 临时托管能跑通**:`dashscope.utils.oss_utils.
  upload_file(model, "file://<abs_path>", api_key)` 返回真实
  `oss://dashscope-instant/<workspace>/<date>/<uuid>/<filename>` URL,
  48 小时自动销毁,主账号强绑定。该函数是 SDK 公开 API(已读源码)。
- **OpenAI 兼容端点 + `oss://` URL + `extra_headers={
  "X-DashScope-OssResourceResolve": "enable"}`** 实跑通过(18MB 真实录像,
  4 分钟,返回带时间轴的详细分析,且模型主动读到了音轨双人对话内容)。
- **omni 系列在该端点强制约束**:必须 `stream=True` +
  `modalities=["text"]`,非流式 400。已在 POC 封装层处理。
- **SDK 没有切片 / offset / 时间窗参数**:翻遍 1.25.23 SDK 源码,
  `start_offset` / `end_offset` / `fps`(用于视频理解) 一个都没有。
  `MultiModalEmbedding` 的 `fps` / `max_video_frames` 是抽帧做向量,
  不是"只看某段时间"。所以"逐段 offset 切片"在 Qwen 上必须客户端
  自己 ffmpeg(B 方案)或放弃(A 方案,本 spec 选择)。
- **Function 容器形态(已实测确认)**:本仓库 `apps/functions/` 现有
  13 个 Function 全部 TS,**Python Function 在本仓库零先例**(诚实记录)。
  但 Appwrite 1.6 + `openruntimes/python:v4-3.12` 镜像已在本机 stack
  拉取存在(`docker images | grep openruntimes/python:v4-3.12`)。
  从镜像内 `/usr/local/server/src/server.py` 源码读出 entrypoint 契约:
  - 入口:`async def main(context)` 或 `def main(context)`(asyncio
    自动检测)
  - I/O:`context.req.{body,body_json,headers,query,path,...}` /
    `context.res.{json,text,binary,empty,redirect,send}` /
    `context.log()` / `context.error()`
  - 依赖:代码根 `requirements.txt` 由 builds-worker 自动 `pip install`
  - 入口文件:`OPEN_RUNTIMES_ENTRYPOINT` env(在 Function 配置里设置,
    例 `src/main.py`)
  - 超时:Header `x-open-runtimes-timeout`,Function 配置 timeout 上限
    900s
  - body 大小:aiohttp `client_max_size=20MB`(单次 request body 上限)
  这些契约与本 design 假设完全兼容。`dashscope` / `openai` /
  `appwrite` 都是纯 Python 包,在该 runtime 必然 pip-installable。
  Wave 0 加 hello-world 部署冒烟(T0.3)作为 belt-and-suspenders,而非
  阻塞性未知。

POC 实现见 `scripts/poc-qwen-omni-video/{qwen_video.py, test_qwen_video.py}`,
所有测试用真实 `DASHSCOPE_API_KEY` 在本机绿过。本 design 把它**晋升**
为生产模块,而非重写。

## 整体架构(数据流不变,provider 替换)

```
┌──────────────┐
│ analyzeSession│   (TS,不动)
│   handler.ts │
└──────┬───────┘
       │ enqueue Function: ANALYZE_SESSION_VISUAL_FUNCTION_ID
       │ + create job row vis_${sessionId}
       ▼
┌──────────────────────────────┐
│ analyzeSessionVisual(Python)│   ← 本 spec 替换的核心
│  ─ main.py                  │
│  ─ handler.py(pure core)   │
│  ─ deps.py                  │
│  ─ qwen_video.py(封装)     │
│  ─ claim.py / visual_*.py   │
└──────┬───────────────────────┘
       │ 1. claim job(deterministic id + 409 CAS,不变)
       │ 2. fetch recording bytes from Appwrite Storage
       │ 3. dashscope.oss_utils.upload_file → oss://...
       │ 4. OpenAI client + oss:// + omni stream → JSON output
       │ 5. clamp/validate keyMoments → VisualAnalysisOutput
       │ 6. patchReportVisualAnalysis(merge into AnalysisReport)
       │ 7. set job status=succeeded
       ▼
┌──────────────────────┐
│ AnalysisReport(scope=session)│
│   .insights.visualAnalysis  │   (契约不变)
└──────┬──────────────────────┘
       │
       ├─► analyzeSurvey/aggregate-visual.ts(survey 汇总,不动)
       ├─► visual-analysis-panel.tsx(keyMoments 跳播放,不动)
       ├─► visual-rollup-section.tsx(受挫度展示,不动)
       └─► reports.ts / workspace/data.ts(读取,不动)

DELETED:sweepGeminiFiles Function、visual_analysis_jobs.geminiFileName/
        geminiUploadedAt 字段(deprecation 一个 cycle 后)
```

## 模块边界与职责

### `apps/functions/analyzeSessionVisual/` (Python,新形态)

| 文件 | 职责 | 来源 |
|---|---|---|
| `src/main.py` | Appwrite Function 入口、env 读取、SDK 装配、`withErrorBoundary` 等价壳 | 新写,等价于现有 TS `main.ts` |
| `src/handler.py` | pure core,接 `Deps` Protocol,返回 `{status, body}`,**禁止 import dashscope/appwrite/openai** | 翻译自 `handler.ts` |
| `src/deps.py` | `Deps` Protocol + `create_real_deps()` 装配 Appwrite SDK / openai client / qwen_video 封装 | 翻译自 `deps.ts`,把 Gemini 装配换成 Qwen |
| `src/qwen_video.py` | Qwen 封装层(`upload_local_video` / `analyze_oss_video` / `analyze_video`),包 `with_retry` + `mask_secret` + Transient/Permanent 分类 | **晋升自** `scripts/poc-qwen-omni-video/qwen_video.py` |
| `src/claim.py` | 并发 claim 决策(`decide_claim`)+ `apply_claim` | 翻译自 `claim.ts`,行为等价 |
| `src/visual_analysis.py` | 数据类(`VisualAnalysisInput` / `RecordingRecord`)+ `recording_mime_type` / `is_visual_recording` | 翻译自 `visual-analysis.ts` |
| `src/prompts/visual_analysis.py` | 整段分析的 prompt 模板(要求模型结构化输出 keyMoments JSON) | 重写,A 方案专用,不复用现有 segment prompt |
| `tests/test_handler.py` | unit:claim / clamp / partial-failure / report patch | hypothesis + pytest |
| `tests/properties/` | property tests(R-Property 表) | 新写 |
| `tests/qwen_live.py` | live 集成(`MERISM_LIVE_TESTS=1` gated),走真实 DASHSCOPE_API_KEY | 复用 POC 套路 |
| `pyproject.toml` | 依赖 `dashscope>=1.25, openai>=2.0, appwrite>=11, hypothesis, pytest` | 新写 |
| `Dockerfile` 或 Appwrite function spec | 指定 python-3.12 runtime,装上述依赖 | 新写,参考 `apps/agent` 形态 |

**边界硬规矩**:
- `handler.py` 只 import 标准库 + `dataclasses` + `typing` + 本 Function
  内部模块。**不**`import dashscope`、**不**`import openai`、**不**
  `import appwrite` —— SDK 全部进 `deps.py` 和 `qwen_video.py`。
- `qwen_video.py` 是唯一允许 `import dashscope` 和 `from openai import OpenAI`
  的文件。封装层之外的代码看到的只是 `analyze_video(config, path,
  prompt) -> VideoAnalysisResult` 这个窄接口。
- secret 不进 `handler.py` 函数签名(只在 `deps.py` env 读取后注入到
  `qwen_video.QwenVideoConfig`)。

### `apps/functions/sweepGeminiFiles/` — DELETED

R6 完成时整目录删除。任何引用此 Function id 的 env / docs SHALL 同 PR
清理。

### `packages/contracts/src/api.ts` — `VisualAnalysisOutputSchema` (微调,向后兼容)

不改字段名/类型/可空性。仅在 JSDoc 上加注释,声明 A 方案下 `segments[]`
退化为单段、`keyMoments[]` 时间戳来源为模型推断而非 offset 切片:

```ts
export const VisualAnalysisOutputSchema = z.object({
  // ... 现有字段不动 ...

  /**
   * Time-coded segments. Under the Qwen A-flow (single integrated analysis)
   * this collapses to ONE segment covering [0, durationMs]. Multi-segment
   * offset slicing is deferred to the segmented sub-spec (B-flow).
   */
  segments: z.array(VisualAnalysisSegmentSchema),

  /**
   * Highlighted moments with timestamps. Under the Qwen A-flow these are
   * INFERRED by the model from the integrated analysis, not derived from
   * deterministic offset slicing. Timestamps are clamped to [0, durationMs]
   * and entries with invalid timestamps are dropped (see qwen_video.py
   * normalize_moments).
   */
  keyMoments: z.array(VisualAnalysisMomentSchema),

  // ... 其余字段不动 ...
});
```

**不**改 schema 本身,**不**改 superRefine,**不**新增字段。下游消费者
零改动。

### `packages/contracts/src/entities.ts` — `VisualAnalysisJobSchema`(deprecation)

```ts
export const VisualAnalysisJobSchema = z.object({
  // ... existing ...

  /** @deprecated Removed in qwen-visual-analysis-cleanup follow-up.
   * Qwen path uses dashscope-managed temporary oss with 48h auto-purge;
   * no long-lived file handle is held by Merism. */
  geminiFileName: z.string().nullable().default(null),
  /** @deprecated as above. */
  geminiUploadedAt: z.string().datetime().nullable().default(null),
});
```

`packages/appwrite-schema/src/schema.ts` 同步 `@deprecated` 注释,字段
保留 `nullable: true`,Function 不再写入。下一个 sub-spec cycle 真正
delete attribute(`pnpm schema:apply` 时显式 destructive flag)。

`apps/agent/agent/contracts.py` 不动 — 该模型不在 agent 镜像中。

## Prompt 设计(A 方案核心)

整段分析的输出结构必须能够同时填满 `summary` / `sentiment` /
`frustrationScore` / `outcome` / `tags` / `tagsFixed` / `tagsFreeform` /
`highlighted` / `keyMoments`,且数值字段有合法范围。

### 输出 JSON schema(模型按此结构产出)

```jsonc
{
  "summary": "string,中文,200-600 字",
  "sentiment": "positive|neutral|negative|mixed",
  "frustrationScore": 0.0,             // [0, 1]
  "outcome": "successful|friction|frustrated|blocked",
  "sentimentSignals": [
    { "kind": "tone_shift|hesitation|...", "evidence": "string", "timestampMs": 0 }
  ],
  "tagsFixed": ["..."],                // 取自 VISUAL_TAG_TAXONOMY 既有枚举
  "tagsFreeform": ["..."],
  "highlighted": false,
  "keyMoments": [
    {
      "timestampMs": 0,                // 必须 ∈ [0, durationMs]
      "label": "string,<=20 字",
      "description": "string,<=120 字"
    }
  ],
  "segmentSummary": {                  // → 退化的 segments[0]
    "title": "string",
    "description": "string",
    "observations": ["string"],
    "issueLevel": "none|minor|major"
  }
}
```

### 字段产出归属(模型 vs Function)

为避免 T2.4 实施时把 schema-required 字段忘了拼装,边界明确如下:

| `VisualAnalysisOutput` 字段 | 产出方 | 来源 |
|---|---|---|
| `source` | Function | 常量 `"recording"` |
| `recordingFileId` | Function | `recording.storageFileId` |
| `durationMs` | Function | `recording.durationMs`(传 prompt 时也告知模型,但写回是 Function) |
| `visualConfirmation` | Function | 模型成功返回非空 `summary` 即 `true`,空/失败即 `false` |
| `modelId` | Function | `config.model`(常量 `"qwen3.5-omni-plus"`) |
| `generatedAt` | Function | `datetime.now().isoformat()` |
| `segments[0]` | Function 拼装(模型出 `segmentSummary`) | `segmentSummary` 包进单段壳 + `evidence:[]` + 时间窗 [0, durationMs] |
| `keyMoments` | 模型(模型出 timestampMs/label/description) | clamp + Function 补 `id="km_<i>"` |
| `summary` / `sentiment` / `frustrationScore` / `outcome` | 模型 | clamp 兜底默认值 |
| `sentimentSignals` / `tagsFixed` / `tagsFreeform` / `highlighted` | 模型 | clamp + 枚举校验 |
| `tags` | 模型 + Function | 模型出基础 tags;Function 在 fallback / partial-failure 时追加 `consolidation_fallback` 等标记 |

### Prompt 模板要点(`prompts/visual_analysis.py`)

- 系统侧明确告知模型:**视频总时长 = `durationMs` 毫秒**,所有
  `timestampMs` 必须 ∈ `[0, durationMs]`,超出会被丢弃。
- 系统侧给出 `VISUAL_TAG_TAXONOMY` 完整枚举,要求 `tagsFixed` 只能从
  其中挑选。
- 必须输出 valid JSON,不带 markdown fence。封装层用 `json.loads` +
  fallback("找第一个 `{` 到最后一个 `}`")。
- 系统侧明确"研究语境":这是质性研究访谈录像,关注受访者的情绪/
  挣扎/卡点/亮点,**不**做 HR / 招聘评估(对齐 `scope.md` 永久排除项)。
- 用户侧附上 `transcript`(stitched,作为对照参考,模型可援引但不强制)。

### Clamp / 校验逻辑(`qwen_video.py::normalize_output`)

| 字段 | 规则 |
|---|---|
| `keyMoments[].timestampMs` | 非数字 → 丢弃;`< 0` → 丢弃;`> durationMs` → clamp 到 `durationMs`;并按时间升序去重 |
| `keyMoments[].label` | 空字符 → 丢弃;长度 > 30 → 截断 |
| `keyMoments[].description` | 空字符 → 丢弃;长度 > 200 → 截断 |
| `keyMoments[].id` | 模型不出 id;封装层补 `km_${index+1}` |
| `frustrationScore` | 非数字或越界 → 0.0;clamp 到 `[0, 1]` |
| `outcome` | 不在枚举 → "successful";配合 `frustrationScore` 一致性 clamp(>=0.6 时不允许 "successful") |
| `sentiment` | 不在枚举 → "neutral" |
| `tagsFixed` | 不在 `VISUAL_TAG_TAXONOMY` 的项移到 `tagsFreeform` |
| `segmentSummary` | 缺失或空 → 用 fallback("访谈录像,详见 summary") |

clamp 失败但能继续的 case 不抛错,job 状态仍 `succeeded`,在
`tags` 末尾附 `consolidation_fallback` 标记(对齐既有 Gemini 路径
fallback 习惯)。

clamp 后再走 `VisualAnalysisOutputSchema.parse(...)`,失败说明 clamp
逻辑漏了,**抛错让 job 进 retry 路径**(可能是模型整批胡言乱语)。

## 错误分类表(`qwen_video.py::_classify`)

实测 + DashScope 错误码文档梳理:

| 现象 / 关键字 | 分类 | retry? | job errorContext.reason |
|---|---|---|---|
| `access denied` / `access_denied` / `unauthorized` | Permanent | no | `permanent_auth` |
| `invalid_api_key` / `invalid api key` | Permanent | no | `permanent_auth` |
| `invalid_request` / `InvalidParameter` / 400 | Permanent | no | `permanent_request` |
| `file too large` / `oversize` / `unsupported` | Permanent | no | `permanent_oversize` |
| `not exists`(本地文件不存在) | Permanent | no | `permanent_input_missing` |
| `throttling` / `rate limit` / `429` | Transient | yes(<=3) | `transient_rate_limit` |
| `timeout` / `timed out` / `download failed` | Transient | yes(<=3) | `transient_timeout` |
| `5xx` / `service unavailable` / `internal error` | Transient | yes(<=3) | `transient_5xx` |
| 未匹配 | Transient | yes(<=3,with_retry 兜底) | `transient_unknown` |

DashScope 临时 oss 100 QPS 限流命中时返回 throttling 类信息,自动
进 Transient 通道。单租户实测无此风险,留作未来高并发迁自建 OSS 的
触发条件(留 ADR-0010 §future-work 一句)。

## 触发链路(零改动)

`apps/functions/analyzeSession/src/handler.ts` 的关键 deps 接口
**保持不变**:

```ts
interface AnalyzeSessionDeps {
  createVisualAnalysisJob?(args: {sessionId, surveyId, ownerUserId, now}): Promise<void>;
  enqueueVisualAnalysis?(sessionId: string): Promise<void>;
}
```

`deps.ts` 的实现也基本不变,只是被触发的 Function id 指向同一个
`ANALYZE_SESSION_VISUAL_FUNCTION_ID`,但底层运行时从 node 切到 python。
对调用方完全透明 — Appwrite Functions API 是 runtime-agnostic 的。

`createVisualAnalysisJob` 的写入字段从

```ts
{ status:"queued", geminiFileName: null, geminiUploadedAt: null, ... }
```

简化为(deprecation 期保留两个字段写 null,删除期一并删):

```ts
{ status:"queued", attemptCount: 0, ... }
```

期间 `analyzeSessionVisual` (Python) 不读不写这俩字段。

## 并发 / 幂等(行为镜像现状,不发明新机制)

完全镜像 `claim.ts::decideClaim`,翻译为 Python `claim.py::decide_claim`:

```python
@dataclass(frozen=True)
class ExistingJob:
    status: VisualAnalysisJobStatusValue
    attempt_count: int
    updated_at_ms: int

@dataclass(frozen=True)
class ClaimDecision:
    action: Literal["create", "claim", "skip", "fail_permanent"]
    next_attempt_count: int = 0
    status: VisualAnalysisJobStatusValue | None = None

def decide_claim(existing: ExistingJob | None,
                 *, now_ms: int, attempt_cap: int, stuck_after_ms: int) -> ClaimDecision:
    # 行为完全等价 TS 版,逐行翻译:
    # - 无行 → create(attempt=1)
    # - 终态(succeeded/failed)→ skip
    # - in-flight 但 stuck > stuck_after_ms → claim(attempt+=1)
    # - in-flight 未 stuck → skip
    # - attempt_count >= cap → fail_permanent
    ...
```

`apply_claim` 的 Appwrite SDK 调用同样镜像 TS 版,只是 Python `appwrite`
SDK 的方法名是 `databases.create_document` / `update_document`,异常用
`AppwriteException.code == 409` 判定。

property test "并发 N → 仅一个 claimed=True" 用 in-memory `Deps` 跑
hypothesis,等价于现有 TS 测试。

## Live test 策略

`tests/qwen_live.py` 走 `MERISM_LIVE_TESTS=1` gating,跟 POC 等价用
真实 `DASHSCOPE_API_KEY`:

| live test | 输入 | 期望 |
|---|---|---|
| `test_color_clip_content` | `test_colors.mp4`(8KB) | 输出含 ≥3 个颜色字 + `keyMoments` 全部时间戳 ∈ `[0, durationMs]` |
| `test_real_recording_18mb` | egress mp4(18MB) | `summary` 字数 > 100 + `oss_url.startswith("oss://")` + `modelId == "qwen3.5-omni-plus"` |
| `test_oversize_rejected` | 拼一个 fake 3GB header | `PermanentProviderError` + `errorContext.reason="oversize_bytes"` |
| `test_bad_path_permanent` | 不存在的 path | `PermanentProviderError`(对齐 POC `Test 3`) |

CI 不跑 live;开发本机 / staging 跑。POC 的 4 个测试本身就是这套形态的
已绿版本,迁过来即可。

## R10 时长上限 grace 说明

`recording.durationMs` 由 LiveKit egress 元数据回填,实测在异常断开
场景下可能多估几秒到几十秒。R10 验收标准的 1 小时硬阈值,实际实施
时建议给 **5 分钟 grace**(即 `> 65 * 60_000` ms 才拒),避免 65 分钟
访谈被误判 oversize。该 grace 不放宽 DashScope 真实上限(2GB/1h)的
认知 — 是对我们自己 durationMs 字段精度的容忍。

## 安全 / 隐私评估

| 关注点 | A 方案下的现状 | 是否新增风险? |
|---|---|---|
| 录像内容传出 | SDK 推到百炼 oss-instant 临时空间(主账号绑定,48h 自动销毁) | 与 Gemini 时代等价,只是落点从 Google 换百炼 |
| 录像公网可下载窗口 | **无** — `oss://` 不是公网 URL,只能由我们的 API key 在调用模型时附 `X-DashScope-OssResourceResolve` 解析 | 比"presigned https URL"路径更安全 |
| API key 泄露 | `DASHSCOPE_API_KEY` 仅在 `deps.py` env 读,`mask_secret` 处理日志 | 与现有 Qwen ASR/TTS 一致 |
| 自托管 Storage 暴露公网 | **不需要** — Appwrite Storage 仍可保持 `localhost`,Function 在容器内 `getFileDownload` 拿字节,本地推 SDK | A 方案最大的隐私保留点 |
| 限流(100 QPS 临时托管) | 单租户、异步任务、无并发风暴风险 | 留作 ADR-0010 §future-work 触发条件 |

## 与现有 spec / ADR 的关系

| 参考 | 关系 |
|---|---|
| ADR-0004 (Gemini provider) | **被本 ADR-0010 取代**(R7) |
| ADR-0005 (visual durability) | §D1 / §D3 保留;§D2(Gemini 文件 GC)被取代(R4) |
| ADR-0007 (Gemini Live realtime) | 不冲突。本 ADR-0010 **不承诺 provider 收敛**,只把事后视觉路径换 Qwen;实时访谈层(Gemini Live vs Qwen-Omni-Realtime vs 现有 cascade)由 ADR-0007 / 后续 ADR 决定。两条路径独立 |
| spec `analysis-report-v2` | 消费 `VisualAnalysisOutput` 不变 |
| spec `report-evidence-playback` | survey 汇总不变 |
| spec `transcript-correction`(未立) | 未来协同点:此次 Qwen 调用已经把视频+音频喂给 Omni,该 spec 可复用本封装层 |

## 已知 trade-off / 后续 follow-up

- A 方案 keyMoments 时间戳是模型推断,精度 vs Gemini 确定性 offset 切片
  下降。研究员"点高光时刻跳播放"体验在 4 分钟以内基本无感,长视频
  (>30 分钟)可能漂移几秒到十几秒。验收用户反馈后决定是否启动 B 方案
  spec。
- 单段 segments 牺牲了"逐段 issueLevel" 精度。下游 `visual-analysis-panel.tsx`
  原本就允许 segments 为空状态,UI 上不会出错,但"分段视图"会变成
  单段视图。可在 ADR-0010 §UI-impact 记一笔。
- T5.2 漂移阈值:**模型推断时间戳 vs 真实事件时间的差值,
  超过 `min(录像总长 1%, 10s)` 视为"漂移"**。该阈值替代 spec 初稿的
  "30s 绝对阈值"(过松,1 小时录像里 30s 仅 0.8% 用户感知差但工程上
  无法拒绝)。漂移占比 > 30% 时启动 B 方案 sub-spec。
- DashScope 临时 oss 单文件可见性域为主账号 + 48 小时;若将来研究员
  需要 keep recording in cold storage > 48h 内可重分析(retry 跨日),
  须先重新上传(我们手上没有 oss handle 长效引用)。文本报告已ship 的
  情况下,这是可接受的(`analyzeSessionVisual` 的 attemptCount 设计
  在 24h 内多次 retry 已足够)。
