# Implementation Plan — notebooks

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。涉及 schema 改动需 `pnpm schema:apply && pnpm schema:verify` 验证幂等; 涉及 web 改动需 `pnpm -F web build` 验证; 全 spec 要 scope-guard OK + 全量测试绿。

## Wave A — Rename (Insight → Notebook 字面替换, schema 形态保持等价)

- [ ] **T1** packages/contracts: 把 `src/insight.ts` 重命名为 `src/notebook.ts`, 内容把所有 `Insight` 改为 `Notebook` (保持 fixed schema 等价, 不动字段); 同步 `index.ts` re-export; 加 backward-compat alias `export type Insight = Notebook; export const InsightSchema = NotebookSchema; export const insightReportSchema = notebookReportSchema`(让旧 import 暂不破)。`pnpm -F @merism/contracts build && typecheck` 全绿。

- [ ] **T2** packages/appwrite-schema/src/schema.ts: 加 `notebooks` collection (字段同旧 `insights` schema, 不加新字段, Wave B 才加 content/textContent 等)。旧 `insights` collection 保留。`pnpm schema:apply && pnpm schema:verify` 在本地 stack 幂等通过。

- [ ] **T3** apps/agent/agent/contracts.py: 把 `Insight` 改名为 `Notebook` Python class; 加 `Insight = Notebook` alias 保兼容。`pnpm test:py` 全绿。

- [ ] **T4** apps/web 路由 rename: `git mv app/insights/ app/notebooks/`(物理删旧, 路由参数仍是 `[id]` 不改 `[shortId]` — 因为 Wave A schema 还没加 shortId 字段, 等 Wave B T15 才改)。前端代码中的 `Insight` / `insights` 引用全部改为 `Notebook` / `notebooks`(批量 sed/python rewrite, 但**白名单**: `AnalysisReport.insights` 字段 / `top_insights` widget type / `analysis_reports` collection 中 `insights` JSON 字段 这些不要改, 是另一个语义)。

- [ ] **T5** apps/web 组件 rename: `git mv components/insights/ components/notebooks/`(物理删旧目录), 内部 file 用 sed `s/insight-detail/notebook-detail/g` 等 + import / props / state 名跟着改。

- [ ] **T6** apps/web lib rename: `git mv lib/actions/insights.ts lib/actions/notebooks.ts`, `git mv lib/queries/insights.ts lib/queries/notebooks.ts`, `git mv lib/insights.ts lib/notebooks.ts`。读写函数从用 `insights` collection 改为用 `notebooks` collection (Wave A schema 等价, 字段集 == insights, 不加 content/textContent, Wave B T11 才加)。

- [ ] **T7** apps/web Morris 工具 rename: `lib/assistant/tools/analyze-data.ts` 中关于 insight 命名改为 notebook (envelope artifact key 等); `lib/assistant/__tests__/tools.test.ts` 同步。`workspace-map.ts` (sidebar nav) 中"Insights" → "Notebooks"。

- [ ] **T8** 文档同步: `AGENTS.md` 第 5 个例子 ("Insight collection ... ADR-0003 D2") 改为 "Notebook collection ... 演进自 Insight, ADR-0003 D2 沿用"。`docs/adr/0003-analysis-report-architecture.md` D2 段加更新注脚说明 Insight 已演进为 Notebook (本 spec)。

- [ ] **T9** Wave A 验证: `pnpm typecheck && pnpm -F web build && pnpm test && pnpm test:properties && pnpm scope-guard` 全绿。**Commit Wave A**。

## Wave B — Schema 演进 (加 ProseMirror content + plain mirror + shortId + visibility + embedding 字段)

- [ ] **T10** packages/contracts: 改 `src/notebook.ts` `NotebookSchema` 加字段 `shortId` / `content` / `textContent` / `visibility` / `embedding` / `embeddingModel`; 原 `report` 字段改为 nullable default null (Wave D 后续 deprecate)。**不加 `version` / `lastModifiedAt` / `lastModifiedBy`**(D10: Notebook 只读, 无 update 路径)。

- [ ] **T11** packages/appwrite-schema: 改 `notebooks` collection attributes 加上述新字段(见 design §5.1) + 索引 by_owner / by_study / by_owner_short(unique) / by_text_search(fulltext)。`pnpm schema:apply && schema:verify` 幂等通过。

- [ ] **T12** packages/appwrite-schema: 加 `notebook_share_tokens` collection (见 design §5.3) + 索引 by_token(unique) / by_notebook。

- [ ] **T13** apps/web/lib/notebooks/short-id.ts: `generateShortId(): string` 返回 12 char alphanumeric (用 randomBytes(8) → base36 padStart)。`isValidShortId(s): boolean` 校验。`tests/short-id.test.ts` 含 1000 次生成无碰撞 + 长度/字符集校验。

- [ ] **T14** apps/web/lib/queries/notebooks.ts + actions/notebooks.ts: 改写读 / 写函数支持新 schema。新 notebook 创建时 populate shortId / visibility=internal / content="" / textContent="" / embedding="" / report=null。读时按 shortId 不是 $id。**不存在 update 路径**(D10), saveNotebookFromMarkdown 永远 create 新 row。

- [ ] **T15** apps/web 路由参数 `[id]` → `[shortId]`: app/notebooks/[shortId]/page.tsx 内查询用 shortId; 旧 $id-based URL 重定向到 shortId-based(用 redirect)。

- [ ] **T16** Wave B 验证 + commit。

## Wave C — TipTap 集成 + 8 类 merism-* node + 卡片视图 + 文档视图

- [ ] **T17** apps/web/package.json 加依赖 `@tiptap/react @tiptap/pm prosemirror-markdown` (**不加** `@tiptap/starter-kit` — 我们只渲染不编辑, D10), 或者更轻直接 `prosemirror-view + prosemirror-model + prosemirror-markdown` 不引入 Tiptap。本 task 内决定具体技术路径(Tiptap-readonly vs 纯 ProseMirror), 影响后续 T22-T24 的 import。

- [ ] **T18** apps/web/lib/notebooks/markdown-to-prose.ts: 纯函数 `markdownToProseMirror(markdown): ProseMirrorJSON`, 用 prosemirror-markdown 转基础 Markdown + 扫 `<merism-*>` tag 替换为对应 ProseMirror node。**未闭合 tag fallback** (流式生成时常见): 检测到未闭合 `<merism-*` (无对应 `>` 或 `</merism-*>`) → 当前不 panic, 把未闭合段当作 plain text 渲染, 等闭合 tag 到达再重新解析。`tests/markdown-to-prose.test.ts` 含基础 + 8 类 tag 各一个 case + 未闭合 tag fallback + 边界 (空字符串 → 空 ProseMirror doc / 无 tag 的纯 Markdown / 坏 tag 属性)。注: merism-* node 是 atom node, **不存在嵌套**, 不测嵌套 case。

- [ ] **T19** apps/web/lib/notebooks/prose-to-markdown.ts: 反向函数, 让研究员编辑后能 export 为 Markdown / 让 Morris 读现有 Notebook content 拼到 chat context。

- [ ] **T20** apps/web/lib/notebooks/heading-template.ts: 纯函数 `extractCardSections(content): CardSections | null` (P-NB-02 锁定), 见 design §7.4。`tests/heading-template.test.ts` 含 5 段完整/缺 1 段/heading 顺序乱/多 H1。

- [ ] **T21** apps/web/lib/notebooks/filter-for-sharing.ts: 纯函数 `filterNotebookContentForSharing(content, allowlist): ProseMirrorJSON` (P-NB-03 锁定), 见 design §7.x + PostHog `filter_notebook_content_for_sharing`。`tests/filter-for-sharing.test.ts` 含各 allowlist + 嵌套 + paragraph 不动 + 幂等。

- [ ] **T22** apps/web/lib/notebooks/tiptap-extensions.ts (或 prose-extensions.ts): 8 类 merism-* ProseMirror Node spec (atom node + parseHTML + renderHTML + addAttributes + ReactNodeViewRenderer)。**只定义渲染路径, 不定义 input rules / commands / shortcuts** (D10 只读)。

- [ ] **T23** apps/web/components/notebooks/nodes/ 8 个 React 组件 (merism-quote.tsx / merism-video-clip.tsx / merism-theme.tsx / merism-video-observation.tsx / merism-insight-link.tsx / merism-question-stat.tsx / merism-cross-study-citation.tsx / merism-session-link.tsx) 各自渲染卡片 + 点击跳转行为 (quote 跳 transcript / video-clip 跳录像 ms / 等)。

- [ ] **T24** apps/web/components/notebooks/card-view.tsx (新) + document-view.tsx (新): card-view 调 extractCardSections(content) → 渲染 5 段卡片 (复用现有 Insight UI 设计); **document-view 只读** — 用 `EditorContent editable={false}` (Tiptap 路径) 或 `prosemirror-view` 直接渲染 (纯 ProseMirror 路径, 由 T17 决定), **不加 slash command / drag handle / 工具栏 / 编辑保存逻辑** (D10)。notebook-detail.tsx 加视图切换按钮 (默认卡片视图; 模板命中 → 卡片; 不命中 → 提示"切到文档视图查看")。

- [ ] **T25** Wave C 验证 + commit。

## Wave D — Morris createNotebook + 流式生成 + system prompt

- [ ] **T26** apps/web/lib/server/notebooks.ts: server-side 函数 `saveNotebookFromMarkdown(args)`: 校验 → markdownToProseMirror → 抽 textContent (从 ProseMirror 抽 plain text) → **永远 create 新 row**(generateShortId() 生成新 shortId, D10 决策无 update 路径)。Wave E 在此基础上加 embedding 触发(在 stream 结束一次性生成, 见 B1 修订)。

- [ ] **T27** apps/web/lib/assistant/tools/create-notebook.ts: Morris `createNotebook` 工具 (见 design §8.1)。inputSchema = CreateNotebookRequestSchema; execute 调 saveNotebookFromMarkdown + 包 envelope。

- [ ] **T28** apps/web/lib/assistant/tools/index.ts 注册 createNotebook 工具。

- [ ] **T29** apps/web/lib/assistant/system-prompt.ts: 在 `<rules>` 段加 `<rule name="create-notebook-for-reports">` (见 design §8.2)。

- [ ] **T30** apps/web/lib/assistant/agent.ts: prepareStep 加 PageContext.surveyId 自动注入逻辑 — pageContext.surveyId 存在时 createNotebook 工具默认填 studyId (借 morris-agent-hardening 已有的 page-context 模式扩展)。

- [ ] **T31** apps/web 流式预览: components/assistant/conversation.tsx 监听 onChunk, 检测 toolCall.name=createNotebook 时把 content 增量 append 到一个 NotebookPreviewPanel 状态, 增量 markdownToProseMirror 解析 → 渲染。**半截 tag fallback**: markdownToProseMirror 内置半截 `<merism-*` 检测, 未闭合 tag 段当作 plain text 渲染, 等闭合 tag 到达再重新解析(T18 已实现)。**embedding 不在流式过程中重算**(B1 修订): 仅 tool 调用结束(整份 content 落库)后, server-side 调一次 embedQuery(textContent) 落 embedding 字段。tool 调用结束时跳 /notebooks/{shortId} 或在对话内展示打开 notebook 卡片。

- [ ] **T32** tests: apps/web/lib/assistant/__tests__/create-notebook.test.ts: tool 调用正常路径 / Markdown 解析失败处理(envelope error) / draftContent 不流式给前端路径 / 半截 tag fallback 不抛错。**不测 update existing 路径**(无该路径)。

- [ ] **T33** Wave D 验证 + commit。

## Wave E — Embedding 生成 + 跨 study 检索

- [ ] **T34** apps/functions/searchAcrossNotebooks/ 骨架 (参照 analyzeSession/ 结构): package.json / tsconfig.json / src/{handler,main,deps,embedder-qwen,cosine}.ts + tests/。

- [ ] **T35** src/embedder-qwen.ts: `embedText(text): Promise<number[]>` 调 Qwen DashScope text-embedding-v3 (1024 dim) via OpenAI 兼容端点 (复用 DASHSCOPE_API_KEY 环境变量)。失败抛 EmbeddingError({ kind, message })。**注: 同 module 第一版用复制粘贴方式在 apps/functions/searchAcrossNotebooks/src/embedder-qwen.ts 与 apps/web/lib/server/notebooks.ts 各放一份(~30 行 wrapper, 代码重复但跨 runtime 简单)**(B4 修订决策); 当多 Function 都需要 embedder 时再抽到 packages/llm-providers, 第一版 YAGNI。

- [ ] **T36** src/cosine.ts: 纯函数 `cosineSimilarity(a, b): number` (见 design §9.3)。tests/cosine.test.ts: 平行 / 正交 / 反向 / 不同维度抛错 / 空向量。

- [ ] **T37** src/handler.ts: searchAcrossNotebooks pure core (见 design §9.2)。Deps interface 含 `embedQuery(query)` / `loadNotebooksWithEmbedding(ownerUserId, studyIdFilter)` / `searchNotebooksFulltext(query, ownerUserId, studyIdFilter)` (fallback 用)。tests/handler.test.ts: ownership / studyId 过滤 / cosine top N / fallback 路径。

- [ ] **T38** apps/web/lib/server/notebooks.ts: saveNotebookFromMarkdown 在 stream 结束(整份 content 落库)调一次 embedder.embedText(textContent) 生成 embedding, 落 embedding + embeddingModel 字段。**因 D10 Notebook 只读, embedding 一旦生成即不再变化**, 不需要 sha256 比较或重生成逻辑。

- [ ] **T39** apps/web/lib/assistant/tools/search-across-studies.ts: Morris 工具 (见 design §9.4)。注册到 tools/index.ts。

- [ ] **T40** apps/web/lib/assistant/system-prompt.ts: 加 `<rule name="search-past-research">` (见 design §9.4)。

- [ ] **T41** Wave E 验证 + commit。

## Wave F — 验证 + cleanup

- [ ] **T42a** Wave A 末尾(在 T9 内)新增 `tests/properties/notebooks/p-nb-01a-rename-equivalent.test.ts`: 旧 Insight document → Wave A 字面 rename 后字段一一映射, headline/themes/divergences/actions 全部一致。
- [ ] **T42b** Wave B 末尾(在 T16 内)新增 `tests/properties/notebooks/p-nb-01b-fallback-defaults.test.ts`: Wave A 阶段 Notebook → Wave B schema 演进后默认值 fallback 读出 + NotebookSchema.parse 通过 + lazy 补 shortId 路径。

- [ ] **T43** 新增 `tests/properties/notebooks/p-nb-02-heading-template-deterministic.test.ts`: extractCardSections 对模板符合 / 不符合的 Markdown 分别给 CardSections / null, deterministic。

- [ ] **T44** 新增 `tests/properties/notebooks/p-nb-03-filter-for-sharing-closure.test.ts`: filterNotebookContentForSharing 闭包 + 幂等 + paragraph 不动。

- [ ] **T45** 新增 `tests/properties/notebooks/p-nb-04-embedding-cosine-stability.test.ts`: mock Qwen 注入确定性向量, 验证 cosine 排序 deterministic + 同 textContent ≥ 0.99 + 不同 textContent < 0.5。

- [ ] **T46** Cleanup 旧 alias: 删 contracts 中 `Insight = Notebook` 类型别名 + `InsightSchema = NotebookSchema` 等 backward-compat alias; 任何还在 import `Insight` 的代码报错 → 修正成 `Notebook`。删 `apps/web/lib/insights.ts` / `actions/insights.ts` / `queries/insights.ts` / `app/insights/` / `components/insights/` 旧路径 (Wave A 时已 rename 到 notebooks, 旧路径如有残留就在此 commit 删)。

- [ ] **T47** Cleanup 旧 schema: `pnpm schema:apply` 把 `insights` collection 删除 (单独 commit, destructive flag 显式确认; 因用户已确认无真实数据所以是单纯 schema 清理)。`scripts/scope-guard.ts` 加 forbidden 词 `\bInsight\b`(白名单 `AnalysisReport.insights` / `top_insights` widget type 等正在使用的合法词)。

- [ ] **T48** Cleanup `Notebook.report` fallback 字段: D10 决策 Notebook 只读(无手工编辑) + 永远 create 新 row, Wave D Morris createNotebook 已经只 populate content + textContent 不 populate report; 旧 Notebook 的 report 字段是只读历史不影响新数据。Wave F 在 contracts + schema 中删除 report 字段, 旧 Notebook 行的 report 字段读时被 schema.parse 忽略(允许 unknown key)。

- [ ] **T49** 全量校验: `pnpm typecheck && pnpm -F web build && pnpm scope-guard && pnpm test && pnpm test:properties` 全绿。`pnpm schema:apply && pnpm schema:verify` 在本地 stack 幂等通过。`pnpm smoke` 通过(含 Morris createNotebook 端到端 tap)。

- [ ] **T50** Wave F 全部完成 + commit。

## 依赖波次

```
A (rename) ── B (schema 演进) ── C (TipTap) ── D (Morris createNotebook 流式)
                                                  ↓
                                                  E (embedding + searchAcrossStudies)
                                                  ↓
                                                  F (PBT + cleanup)
```

A 必须完整完成 (字面 rename + schema:apply 加 notebooks collection) 才能进 B (schema 演进)。
B 完成后 C 与 D 不强依赖 (TipTap 集成与 Morris 工具独立), 但 C 先完成让前端能渲染 D 流式生成的 content。
E 依赖 D (要在 saveNotebookFromMarkdown 内加 embedding 触发)。
F 必须最后跑 (cleanup 删旧 alias 时若前置任务未完, typecheck 会报)。

