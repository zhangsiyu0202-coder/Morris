# Requirements Document


> **Footnote (Wave C T17 实施期):** spec 中 R6 / D9 描述的 "share notebook" / "share token" / `filter_for_sharing` / `SHARED_ALLOWLIST` / `Notebook.visibility = "shared"` / `notebook_share_tokens` collection, 在实施时统一重命名为 **publishing** 语义 (`filter_for_publishing` / `PUBLISHED_ALLOWLIST` / `visibility = "published"` / `notebook_publish_tokens`), 以避免与 AGENTS.md scope-guard 中明确禁止的 "team / collaboration sharing" 概念混淆。语义不变 — 仍是 researcher 把 notebook 单向发布给外部受众的只读链接 (类似 publish-to-blog 而非 multi-user collaboration), 不引入第二个用户 / 协作 / 评论 / 权限矩阵。

## Feature: notebooks（Insight 演进为 Notebook）

## Introduction

把已 ship 的 `Insight` 演进为 `Notebook`:从"AI 输出固定 schema 论证报告卡片"演进为"AI 写富文本研究文档,研究员可继续编辑、嵌入引用、对外分享"。

当前 Insight 是 fixed schema(headline / directAnswer / themes / divergences / actions),研究员只能看卡片视图,没法编辑、没法嵌入 video moment、没法引用其他 study quote、没法对客户讲故事。

蓝图 stage 7:研究员问 Morris 一或多个研究问题 → Morris 写带 quote / video clip / theme 卡片引用的研究文档 → 研究员继续编辑加自己解读 → 对客户讲故事。

借鉴 PostHog `products/notebooks/` + `ee/hogai/tools/create_notebook/`:TipTap 富文本 + AI 流式写 Markdown + 自定义 widget node + 分享 allow-list。

严格遵守 AGENTS.md "Optimize technology, never change its purpose":**Insight 整体改名为 Notebook**, fixed schema 演进为可编辑富文本 + 保留约定 heading 模板让卡片视图无缝渲染。

## Prerequisite

- `foundation-setup/design.md` 与 `analysis-report/design.md`(已落地 Insight + /insights 路由 + Morris analyzeData)
- `analysis-report-v2/design.md`(已落地)
- `morris-agent-hardening/design.md`(已落地 ToolLoopAgent + envelope + PageContext + system-prompt 渲染)
- `docs/adr/0003-analysis-report-architecture.md` D2(Insight 与 AnalysisReport 分离, 本 spec 沿用 — 演进 Insight 不合并 AnalysisReport)
- 借鉴来源:
  - `/home/jia/posthog/products/notebooks/backend/models.py` — Notebook / ResourceNotebook
  - `/home/jia/posthog/products/notebooks/backend/util.py::filter_notebook_content_for_sharing`
  - `/home/jia/posthog/ee/hogai/tools/create_notebook/{tool,parsing,tiptap}.py` — AI 写 Notebook 标准 prompt + Markdown→ProseMirror
  - `/home/jia/posthog/ee/hogai/chat_agent/notebook_streaming.py` — 流式生成 + 实时预览

## Glossary

| 术语 | 含义 |
|---|---|
| **Notebook** | 核心实体, 替代 Insight。collection id `notebooks` |
| **Notebook.content** | ProseMirror JSON 文档树。AI 写 Markdown → 解析为 ProseMirror |
| **Notebook.textContent** | plain-text mirror, fulltext + embedding 用 |
| **HeadingTemplate** | 约定 `# Question / ## 核心结论 / ## 主题分析 / ## 立场分歧 / ## 行动建议` |
| **CardView vs DocumentView** | 前端两种渲染: 默认按 heading 抽段渲染卡片(兼容现有 UX); 切到 TipTap 文档视图编辑 |
| **merism-* node** | ProseMirror 自定义节点 8 类: `merism-quote` / `video-clip` / `theme` / `video-observation` / `insight-link` / `question-stat` / `cross-study-citation` / `session-link` |
| **createNotebook tool** | Morris 新工具(借 `AssistantTool.CREATE_NOTEBOOK`), 流式生成 |
| **filter_for_sharing** | 分享 allow-list, 含 PII 的 node 剥到只剩 type |
| **Notebook.embedding** | Qwen DashScope `text-embedding-v3` 1024 维, 跨 study cosine 检索 |

## Scope

**包含**:

1. **Insight → Notebook 完整 rename**: collection id / contracts type / 路由 / 组件 / lib 全部改名。Python mirror 同步。
2. **Schema 演进**: `Notebook` 加 `shortId`(12 字符 alphanumeric) / `content`(ProseMirror JSON) / `textContent`(plain mirror) / `visibility`(internal|shared) / `embedding`(1024 维向量) / `embeddingModel`。原 `report` 字段保留作 fallback(旧数据兼容,新写不再产出)。**不加 `version` / `lastModifiedAt` / `lastModifiedBy`**(D10 决策: Notebook 只读)。
3. **AI 写 Notebook**: Morris ToolLoopAgent 加 `createNotebook` 工具, 接 Markdown 字符串 + `<merism-*>` tag, 流式生成 + 前端实时预览。
4. **HeadingTemplate 约定**: prompt 约束 AI 输出 `# Question / ## 核心结论 / ## 主题分析 / ## 立场分歧 / ## 行动建议` 5 段 heading。前端解析时:识别到模板 → 卡片视图; 识别不到 → 自由文档视图。
5. **8 类 merism-* node**: TipTap 集成 + 各 node 的 React 渲染组件 + 点击行为(quote 跳 transcript / video-clip 跳录像 startMs / theme 跳 theme 详情 / cross-study-citation 跳目标 study report)。
6. **filter_for_sharing**: 含 PII 的 node(merism-session-link / merism-video-clip 默认含)分享时剥 attrs 只留 type, 前端渲染 placeholder。
7. **跨 study embedding 检索**: `Notebook.embedding` + `searchAcrossNotebooks(query)` Function + Morris 工具 `searchAcrossStudies`。
8. P-NB-01 (rename round-trip), P-NB-02 (heading 模板抽段确定性), P-NB-03 (filter_for_sharing 安全), P-NB-04 (embedding cosine 稳定性)。

**排除**:

- ❌ **不引入 KernelRuntime / Python 代码块 / DuckSQL / HogQL SQL node**:Merism 不是 OLAP 平台,研究员不写代码。PostHog 这部分跟 Merism scope 无关。
- ❌ **不引入 ResourceNotebook 关联表**:Notebook 一对一关联到 study(已有 `studyId` 字段),不需要 group / account 等多类资源关联。
- ❌ **不做手工编辑**(D10 决策): Notebook 一旦由 Morris 创建即只读, 研究员要修改通过 Morris 对话重新生成新一份。不需要 OT/CRDT/多 tab 冲突检测/编辑工具栏/slash command/drag handle。研究员通过 Morris 对话调整内容(类似 ChatGPT Canvas)。
- ❌ **不做 Plan mode**(PostHog Max 用 notebook 做规划文档): Merism 的 Morris 不做 planning, 当前 morris-agent-hardening 的 TodoWrite 工具已覆盖"多步任务计划",不再加 Plan-mode-as-notebook。
- ❌ **不做 MCP 端点**: Merism 当前不暴露 MCP, 加端点会引入授权/限流复杂度, 第一阶段不做。
- ❌ **不重做 AnalysisReport**: AnalysisReport 仍保留 fixed schema 自动生成; Notebook 是 Insight 演进, 两者职能分离(ADR-0003 D2 沿用)。

## Requirements

### Requirement 1: Insight → Notebook 整体 rename

**User Story:** 作为平台维护者, 我需要把现有 `Insight` 改名为 `Notebook` 让命名跟新形态一致, 避免"叫 Insight 但内容是富文本 deck"的语义漂移。

#### Acceptance Criteria

1. WHEN rename 完成 THEN packages/contracts SHALL 把 `insight.ts` → `notebook.ts`, 类型 `Insight` → `Notebook`, `InsightSchema` → `NotebookSchema`, `InsightReport` → `NotebookReport`(原 schema 保留作 fallback,见 R2)。
2. WHEN rename 完成 THEN packages/appwrite-schema SHALL 加 `notebooks` collection(替代旧 `insights`)。本 spec 不写数据迁移(用户确认无真实数据要保留); `schema:apply` 创建 `notebooks` collection 同时旧 `insights` collection 保留挂着不用,等下个 cleanup commit 删除。
3. WHEN rename 完成 THEN apps/agent/agent/contracts.py SHALL Python mirror 同步: `Insight` → `Notebook`, `InsightReport` → `NotebookReport`。
4. WHEN rename 完成 THEN apps/web 路由 SHALL 改: `/insights` → `/notebooks`, `/insights/[id]` → `/notebooks/[shortId]`(用 shortId 而非 $id 让 URL 友好,见 R2)。
5. WHEN rename 完成 THEN apps/web 组件路径 SHALL 改: `components/insights/` → `components/notebooks/`, `lib/actions/insights.ts` → `notebooks.ts`, `lib/queries/insights.ts` → `notebooks.ts`, `lib/insights.ts` → `notebooks.ts`。
6. WHERE Morris 工具 THEN 当前 `analyze-data` / `search-interview-data` 中如有 "insight" 命名 SHALL 改为 "notebook"(envelope artifact key / system prompt 段)。
7. WHERE 文档 THEN `AGENTS.md` 第 5 个例子("`AnalysisReport` ... `Insight` collection ... ADR-0003 D2") SHALL 改为 "`Notebook` collection (researcher-asked-question + AI-written editable doc)"。`docs/adr/0003-analysis-report-architecture.md` D2 决策段 SHALL 加更新注脚说明 Insight 已演进为 Notebook,本 ADR 沿用 "与 AnalysisReport 分离" 决策。
8. WHEN typecheck / test / scope-guard / web build THEN 全部 SHALL 绿。

### Requirement 2: Schema 演进 (固定 schema → ProseMirror)

**User Story:** 作为研究员, 我需要 Notebook 不只是固定卡片, 还能编辑 / 嵌入引用 / 含跨 study 链接, 同时不破坏现有卡片视图工作流。

#### Acceptance Criteria

1. WHEN Notebook 创建 THEN `notebooks` collection 字段 SHALL 含: `$id` / `studyId` / `studyTitle` / `ownerUserId` / `shortId`(12 字符 alphanumeric, URL 友好) / `question`(研究员的提问) / `content`(ProseMirror JSON, string size JSON_SIZE) / `textContent`(plain mirror, fulltext index, string size 50KB) / `headline` / `summary` / `confidence`(enum, 卡片视图快速字段) / `sampleSize` / `visibility`(internal | shared) / `embedding`(JSON-serialized number[1024]) / `embeddingModel`(e.g. `qwen.text-embedding-v3`) / `report`(原 InsightReport schema 字段, 保留 nullable, 旧数据 fallback)/ `createdAt`。**不含 `version` / `lastModifiedAt` / `lastModifiedBy` 字段** —— Notebook 一旦由 Morris 创建后即不可手工编辑(D10 只读决策); 研究员不满意时通过 Morris 对话生成**新的 Notebook** 而非 update existing。
2. WHERE `Notebook.shortId` THEN unique within owner, 通过 `randomBytes(8) → base36` 生成 12 字符。前端路由用 shortId 而非 $id。
3. WHEN 旧 Insight 数据存在 THEN 本 spec 不做迁移(用户已确认无真实数据); 旧 `insights` collection 在 schema:apply 后保留为遗留(documents 不再读), 后续单独 commit 删除。
4. WHEN Morris 写 Notebook THEN content 字段 SHALL 是合法 ProseMirror JSON; textContent 由后端从 content 抽取。
5. WHERE `Notebook.report` THEN 第一版仍可 nullable populate(让现有卡片视图组件渲染); 第二版前端切换为从 ProseMirror content 按 heading 模板抽段渲染 → 抽到 → 显示卡片; 抽不到 → 显示文档视图(自由 ProseMirror 渲染)。本 spec 在 Wave C/D 完成后 deprecate `report` 字段(写新 notebook 不再 populate, 旧 notebook 仍能读)。
6. WHERE Appwrite index THEN 加 `by_owner`(ownerUserId) / `by_study`(studyId) / `by_owner_short`(ownerUserId + shortId, unique) / `by_text_search`(textContent, fulltext)。
7. WHERE Appwrite document permission THEN 仅 owner 可读写。anonymous 永远无访问。

### Requirement 3: 8 类 merism-* node + TipTap 集成

**User Story:** 作为 Morris(以及研究员), 我需要在 Notebook 内嵌入 quote / video clip / theme 等结构化引用卡片, 让研究员能从 Notebook 直接跳转到 transcript 时刻 / 录像时刻 / theme 详情。

#### Acceptance Criteria

1. WHERE 8 类 merism-* node THEN 每类 SHALL 含:
   - `merism-quote`: { sessionId, transcriptId, segmentIndex, quote(quote 文本), themeIds?[] } — 点击跳 `/studies/[surveyId]?session=...&segment=...`
   - `merism-video-clip`: { sessionId, recordingId, startMs, endMs, label } — 点击跳 video player + seek to startMs(依赖 B2 video-citation)
   - `merism-theme`: { surveyId, themeId, label, mentions, pct } — 点击跳 theme 详情(report 中的 themes 卡片高亮)
   - `merism-video-observation`: { sessionId, observationId, scannerType, scannerLabel } — 点击跳对应 video observation(依赖 B1 video-scanners)
   - `merism-insight-link`: { notebookShortId, headline } — 跳到另一个 Notebook(后向兼容旧 Insight 引用)
   - `merism-question-stat`: { surveyId, questionId, distribution, average } — 渲染 per-question 统计卡片(依赖 A2 survey-branching-and-stats)
   - `merism-cross-study-citation`: { sourceNotebookShortId, sourceStudyId, headline, snippet } — 跨 study 引用, 点击跳源 Notebook
   - `merism-session-link`: { sessionId, sessionAlias?, qualityFlags?[] } — 跳到 session 详情(含 PII, 默认 filter_for_sharing 时剥)
2. WHERE TipTap (ProseMirror) 集成 THEN apps/web SHALL 加 `@tiptap/react @tiptap/starter-kit @tiptap/pm` 等依赖, 实现 8 类 React node renderer + node spec(parseHTML / renderHTML / addAttributes)。
3. WHERE Markdown → ProseMirror 解析 THEN AI 输出的 `<merism-quote sessionId="..." segmentIndex="...">quote text</merism-quote>` 等 tag SHALL 被前端 / 后端解析器(`apps/web/lib/notebooks/markdown-to-prose.ts`)转为 ProseMirror node。
4. WHERE 卡片视图 THEN 前端 SHALL 解析 `Notebook.content` ProseMirror, 检测 heading 模板(`# Question / ## 核心结论 / ## 主题分析 / ## 立场分歧 / ## 行动建议` 5 段); 命中 → 渲染原 Insight 卡片 UI(headline + directAnswer + themes + divergences + actions); 不命中 → 文档视图(直接渲染 ProseMirror)。
5. WHERE 视图渲染 THEN 卡片视图与文档视图 SHALL **均为只读**(D10): 卡片视图按 HeadingTemplate 抽段渲染 5 段卡片; 文档视图直接渲染完整 ProseMirror(prosemirror-view 或 Tiptap `EditorContent editable={false}`),含 paragraph / heading / list 等任意 node + 8 类 merism-* node 可点击跳转。**研究员不能手工编辑 content**。
6. WHERE 视图切换 THEN 研究员 SHALL 可在两种只读视图间切换; 默认卡片视图(若 HeadingTemplate 命中 → 渲染卡片; 否则提示"切到文档视图查看")。
7. WHERE 研究员"修改" Notebook THEN 唯一路径 SHALL 是: 跟 Morris 对话 → Morris 调 `createNotebook` 工具生成**一份全新 Notebook**(新 shortId / 新 createdAt); 旧 Notebook 仍保留在 collection 里(研究员可在 `/notebooks` 列表删除多余版本)。**不存在"update existing notebook" 概念**。

### Requirement 4: Morris createNotebook tool (流式生成)

**User Story:** 作为研究员, 我对 Morris 说"针对 study A 给我分析这 10 个问题", Morris 应该写一份完整 Notebook 而不是一段文字回答。

#### Acceptance Criteria

1. WHERE Morris ToolLoopAgent THEN 加 tool `createNotebook`, 入参 schema(zod):
   ```ts
   {
     studyId: string,                 // 当前 study 上下文(从 PageContext.surveyId 自动注入)
     question: string,                // 研究员的问题(可以是单问或多问拼接)
     content?: string,                // Markdown 字符串(立即流式给用户看)
     draftContent?: string,           // 草稿(不流式展示, AI 内部"先想再写")
   }
   ```
   `content` 与 `draftContent` 互斥(借 PostHog `CreateNotebookToolArgs`)。**永远 create 新 Notebook, 不存在 update 路径**(R3.7 + D10), 删除 PostHog 原 tool 中的 `artifact_id` / `existingNotebookShortId` 入参; 研究员不满意时让 Morris 重新生成新一份。见 design §8.1。
2. WHERE Markdown content 内容约束 THEN system prompt SHALL 要求 AI:
   - 第一行 `# {question}`(或 multi-question 时 `# Study A: 分析 10 个研究问题`)
   - 默认 5 段约定 heading: `## 核心结论` / `## 主题分析` / `## 立场分歧` / `## 行动建议`(让前端能渲染卡片视图; 多问题模式下可以是 `## Q1. ...` / `## Q2. ...` 等灵活)
   - 每个 section 用 `<merism-quote>` / `<merism-video-clip>` / `<merism-theme>` 等 tag 嵌入引用
   - 不要在 Notebook 中重复同一引用
3. WHERE 流式生成 THEN createNotebook 工具调用 SHALL 用 AI SDK 的 `streamText` + `experimental_toolCallStreaming`, 让前端 token-by-token 接收 content 字段, Markdown→ProseMirror 解析增量更新前端预览(借 PostHog `NotebookStreamingMixin`)。
4. WHERE Morris envelope THEN createNotebook 工具返回 `{ content: 'Wrote notebook with 10 questions covered.', artifact: { notebookShortId: 'abc123def456', heading: '...', sectionCount: 10 } }`(沿用 morris-agent-hardening envelope 模式)。
5. WHERE 失败处理 THEN AI SDK 报错 / Markdown 解析失败 THEN envelope 用 `artifact: { error: true, message }`, Morris 不中断对话。
6. WHERE PageContext THEN Morris system prompt SHALL 加规则:研究员在 study workspace `/studies/[id]` 问需要生成报告 / 总结 / 文档时, 默认调 createNotebook 而非纯文字回答; 在全局 `/assistant` 问不绑定具体 study 时(例如"我所有 study 中 pricing 主题被提多少次"), 调 searchAcrossStudies(R5) 而非 createNotebook。

### Requirement 5: 跨 study embedding 检索

**User Story:** 作为研究员, 我问 Morris "我以前研究过类似 pricing 主题吗", Morris 应该跨我所有的 study 找过去 Notebook + AnalysisReport.themes/insights 的相关内容。

#### Acceptance Criteria

1. WHEN createNotebook 流式生成结束(整份 content 落入数据库) THEN 系统 SHALL **一次性**对 `Notebook.textContent` 调 Qwen DashScope `text-embedding-v3` 生成 1024 维向量, 存于 `Notebook.embedding`(JSON.stringify), `Notebook.embeddingModel = "qwen.text-embedding-v3"`。**流式过程中不重复生成 embedding**(避免每个 chunk 调 Qwen 导致成本爆炸, 见 design §9.1)。
2. WHEN 因 D10 决策 Notebook 不可手工编辑 THEN textContent 一旦落库就不再变化, embedding 也不需要重生成(每个 Notebook 一份永久 embedding)。
3. WHERE Function `searchAcrossNotebooks` THEN 接 `{ query: string, ownerUserId: string, studyId?: string, limit?: number(1..20, default 5) }`, 返回 `{ matches: Array<{ notebookShortId, studyTitle, headline, snippet, score }> }`。
4. WHERE 检索算法 THEN 第一阶段用 brute-force cosine: `Database.listDocuments("notebooks", [Query.equal("ownerUserId", ...), Query.select(["$id","shortId","studyId","studyTitle","headline","summary","embedding"]), Query.limit(N)])` 拉精简列(每条 ~12.5KB, N=100 时约 1.25MB 数据传输 + 100 次 JSON.parse + 100 次 1024 维 dot product, 单查询估计 200-500ms)。**当 owner 级 Notebook 数 > `EMBEDDING_BRUTEFORCE_LIMIT = 100` THEN Function 自动 fallback 为 `Query.search("textContent", query)` fulltext 检索, 不跑 cosine**(避免 IO 延迟超过 1 秒); 返回时附 `fallback: "scale-fulltext-only"` 标记。当 N 长期 > 100 再考虑 vector DB(独立 sub-spec)。
5. WHERE Morris 工具 `searchAcrossStudies` THEN 调 searchAcrossNotebooks Function 拿 top N → 渲染为 envelope `{ content: 'Found N relevant notebooks...', artifact: { matches } }`, 让 Morris 在写新 Notebook 时能用 `<merism-cross-study-citation>` tag 引用历史 Notebook。
6. WHERE Embedding fallback THEN Qwen embedding API 失败时 Function SHALL 退化为 textContent fulltext 检索(`Query.search("textContent", query)`), 返回时附 `fallback: "fulltext-only"` 标记。

### Requirement 6: filter_for_sharing 安全模式

**User Story:** 作为研究员, 我想把 Notebook 分享给客户/老板, 但 Notebook 里嵌入了 session-link / video-clip 等含受访者 PII 的引用, 系统应该自动剥这些引用让分享时不外泄。

#### Acceptance Criteria

1. WHERE `Notebook.visibility` THEN 枚举 `internal`(默认, 只 owner 可见) / `shared`(可生成分享 token, 第三方凭 token 只读访问)。
2. WHERE `notebook_share_tokens` collection THEN SHALL 含字段: `$id` / `ownerUserId` / `notebookShortId` / `token`(32-byte random hex, 64 字符) / `expiresAt` / `isRevoked: boolean default false` / `createdAt`。索引 `by_token`(unique) / `by_notebook`。permissions 设 `[]`(server-write only via Function)。
3. WHEN 研究员生成分享 token THEN 系统 SHALL 在 `notebook_share_tokens` collection 创建 token 行(过期默认 7 天), 返回 `/share/notebook/{token}` URL。
4. WHEN 第三方通过 share token 访问 THEN 后端 SHALL 调 `filterNotebookContentForSharing(content)` 纯函数, 把 SHARED_ALLOWLIST 之外的 merism-* node 剥到只剩 type(去掉 attrs / inner content), 返回过滤后 content 给前端。
5. WHERE SHARED_ALLOWLIST THEN 默认 = `["merism-quote", "merism-theme", "merism-question-stat", "merism-cross-study-citation"]`(展示业务洞察); 默认剥 = `["merism-video-clip", "merism-session-link", "merism-video-observation", "merism-insight-link"]`(可能含 PII / 内部引用)。研究员可在 UI 调整某条 notebook 的 allowlist(覆盖默认)。
6. WHERE 前端渲染 THEN 被剥的 node 渲染为 `<UnsupportedNodePlaceholder type="merism-video-clip" />`(显示"已隐藏内部引用"或类似), 不抛错。
7. WHERE share token 失效 / 撤销 / 过期 THEN 第三方访问返 410 gone(借 issueLivekitToken 类似模式, 不是 401 让客户误以为登录问题)。
8. WHERE owner 自己访问 THEN 永远不走 filter, 看完整 content。

### Requirement 7: 验证

#### Acceptance Criteria

1. WHEN 提交前 THEN SHALL 通过 `pnpm typecheck`、`pnpm -F web build`、`pnpm scope-guard`、`pnpm test`、`pnpm test:properties`。
2. WHEN 实现 P-NB-01..04 THEN SHALL 在 `tests/properties/notebooks/` 放可执行 PBT。
3. WHERE Function tests THEN `apps/functions/searchAcrossNotebooks/tests/` 用内存 deps 跑通; Morris createNotebook 工具的解析 + 流式 + envelope 行为有 `apps/web/lib/assistant/__tests__/create-notebook.test.ts` 覆盖。
4. WHEN schema 改动 THEN `pnpm schema:apply` 与 `pnpm schema:verify` 在本地 stack 上幂等通过。
5. WHEN 端到端 THEN SHALL 在本地 stack 上跑通: 研究员问 Morris → Morris 调 createNotebook 流式生成 → 前端实时预览 → 落 `notebooks` collection → 切到文档视图编辑 → 保存 → 跨 study 检索能找到这个 notebook。
6. WHEN 本 spec 范围内的代码改动落地 THEN scope guard forbidden 概念(team / share / billing / quota / plan / seat / usage-meter)SHALL 不被引入。**注意**: `Notebook.visibility="shared"` + `notebook_share_tokens` 是单 owner 生成的对外只读 token, 不是多用户协作 / 团队共享, 不破坏 scope guard。`scripts/scope-guard.ts` 白名单可能要加 `"shared notebook"` 之类关键字避免误报。

## Correctness Properties(本 Spec 拥有)

- **P-NB-01a — Wave A 字段集等价 round-trip**: 对任意旧 Insight document, Wave A 字面 rename 后(schema 形态等价, 不加新字段)能以**完全相同**字段集读出为 Notebook(headline / themes / divergences / actions / report 等所有字段一一映射)。本 PBT 在 Wave A 末尾跑, 锁定 rename 不丢字段。
- **P-NB-01b — Wave B 新字段默认值 round-trip**: 对任意 Wave A 阶段写入的 Notebook(无 shortId / content / textContent / embedding 字段), Wave B schema 演进后能以默认值 fallback 读出 + NotebookSchema.parse 通过(content="" / textContent="" / embedding="" / shortId 为空时由后端 lazy 补一个新生成的 shortId)。本 PBT 在 Wave B 末尾跑, 锁定旧数据兼容。
- **P-NB-02 — Heading 模板抽段确定性**:对任意符合约定 heading 模板的 ProseMirror content, `extractCardSections(content)` 纯函数 SHALL 输出确定的 5 段结构 `{ headline, directAnswer, themes[], divergences[], actions[] }`; 对不符合模板的 content, 返回 null(让前端回退到文档视图)。函数纯函数, 多次调用同 content 结果完全一致。
- **P-NB-03 — filter_for_sharing 安全闭包**:对任意 content + allowlist, `filterNotebookContentForSharing(content, allowlist)` 输出 SHALL 满足:(a) 所有 `type` 不在 allowlist 中的 merism-* node 都被剥到只剩 `{ type }`(无 attrs / 无 inner content); (b) 内置 ProseMirror node(paragraph / heading / list / blockquote 等)不被影响; (c) 该函数是幂等的: `filter(filter(c)) === filter(c)`。
- **P-NB-04 — Embedding cosine 稳定性**:对同一 textContent + 同一 embeddingModel, `embedNotebook(textContent)` 多次调用返回的向量 cosine 相似度 ≥ 0.99(模型固有抖动 + 取整误差容忍); 对完全不同的 textContent, cosine < 0.5。该 PBT 用 mock Qwen adapter 注入确定性向量, 主要验证下游 cosine 计算 + 前 N 排序的稳定性。
