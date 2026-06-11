# apps/web

Per-module supplement for the Next.js 15 (App Router) researcher web app. Read root `AGENTS.md`, `.kiro/steering/design-system.md` (visual + Mauve Quiet rules — binding for ANY UI work), `.kiro/steering/architecture.md`, `.kiro/steering/contracts.md`, and `.kiro/steering/errors-and-observability.md` first. This file holds ONLY rules specific to this app.

## File map

### Routes (`app/`)
| Path | Purpose |
|---|---|
| `app/layout.tsx` | Root layout, font loading, design-system globals. |
| `app/page.tsx` | Landing / marketing-light root (currently uses `lib/mock-session.ts` for the structured-question rendering preview — replaced by `interviewee-portal` sub-spec). |
| `app/home/` | Researcher dashboard. |
| `app/studies/[id]/` | Survey editor (current implementation is a v0-generated draft slated for redesign by `survey-editor` sub-spec). |
| `app/interview/` | Anonymous interviewee surface. UI follows `docs/design/multimodal-interview-and-structured-rendering.md §9`. |
| `app/reports/[surveyId]/` | Survey-scope analysis report viewer. |
| `app/notebooks/` | Researcher Notebook (per ADR-0003 D2). |
| `app/assistant/` | Standalone Morris page assistant. |
| `app/auth/` + `app/login/` + `app/signup/` + `app/settings/` | Researcher auth flows (Appwrite Account-backed). |
| `app/api/assistant/route.ts` | Vercel AI SDK 6 streaming entry for Morris. |
| `app/demo/` | Internal demos. |
| `middleware.ts` | Researcher session gating. |

### Components (`components/`)
| Path | Owns |
|---|---|
| `components/shell/` | Sidebar, top bar, app shell — three-state Sidebar per design-system. |
| `components/studies/` | Survey editor primitives (current Drizzle-backed draft). |
| `components/interview/` | Interviewee pre-flight, two-pane interview room, structured-question rendering. |
| `components/notebooks/` | Notebook list + detail. |
| `components/dashboard/` | Researcher dashboard tiles. |
| `components/report/` | Analysis report viewer. |
| `components/assistant/` | Morris dock + standalone chat. |
| `components/auth/` | Login / signup forms. |
| `components/demo/` | Demo-only widgets. |

### Lib (`lib/`)

**清理后的目录结构** (per "Where new things go" 规则):

| Path | Owns |
|---|---|
| `lib/auth/` | Appwrite Account session helpers (`appwrite.ts`, `current-user.ts`, `actions.ts`) + `owner.ts` (ownerUserId resolver — `getOwnerUserIdOrNull` / `requireOwnerUserId`). |
| `lib/queries/` | Server-side Appwrite **reads** (pure read, no writes). One file per resource (`studies.ts` / `notebooks.ts` / `recordings.ts` / `reports.ts` / `sessions.ts` / `transcripts.ts` / `bookmarks.ts` / `auth.ts` / `client.ts`). |
| `lib/actions/` | Next.js **Server Actions** (write paths). One file per resource (`survey.ts` / `notebooks.ts` / `recordings.ts` / `links.ts` / `bookmarks.ts` / `guide-ai.ts`). |
| `lib/server/` | Server-only utilities **not in queries/ or actions/** — provider clients, file IO. Do NOT import from a `'use client'` file. (`embedder-qwen.ts` / `notebooks.ts` / `recordings.ts`). |
| `lib/hooks/` | React hooks (`use-*` 命名). `use-live-interview.ts` (LiveKit React SDK reading `merism.interviewState`), `use-interview-bootstrap.ts` (token + device pre-flight), `use-interview-session.ts` (mock-driven preview, scoped for `interviewee-portal` sub-spec). |
| `lib/assistant/` | Morris `ToolLoopAgent` setup, tool registry, providers. See *Morris page assistant* section below. |
| `lib/notebooks/` | Notebook conversion utilities (`markdown-to-prose.ts` / `prose-to-markdown.ts` / `heading-template.ts` / `filter-for-publishing.ts` / `short-id.ts` / `types.ts`) + `study-context.ts` (Insights LLM context builder) + `index.ts` (public surface). |
| `lib/interview/` | Interview-flow helpers: `transport.ts` (LiveKit connect / RPC), `issue-token.ts` (calls `issueLivekitToken` Function). |
| `lib/survey/` | Survey draft + read + export: `draft.ts` (`assembleSurveyDraft`), `read.ts` (load helpers), `export-results-csv.ts`. |
| `lib/workspace/` | Workspace area helpers: `data.ts`, `map.ts` (sessions ↔ overview/results/detail mapping), `home-data.ts`. |
| `lib/dashboard/` | Dashboard fetch + assemble helpers. |
| `lib/guide.ts` | **Drizzle/Postgres legacy** v0 editor 编辑态契约. Will be consolidated into `@merism/contracts` per `survey-editor` sub-spec. Do NOT extend. |
| `lib/mock-session.ts` + `lib/mock/` | **Mock fixture** for `app/page.tsx` structured-question rendering preview. Slated for removal in `interviewee-portal` sub-spec. Do NOT extend. |

#### Where new things go (`lib/`, binding)

| New thing | Goes in | Naming |
|---|---|---|
| Server-side Appwrite read | `lib/queries/<resource>.ts` | one file per resource (kebab-case) |
| Server Action (write) | `lib/actions/<resource>.ts` | one file per resource (kebab-case) |
| Server-only helper (not read or write) — provider client, file IO | `lib/server/<helper>.ts` | kebab-case |
| React hook | `lib/hooks/use-<topic>.ts` | `use-*` prefix mandatory |
| Feature-internal business logic | `lib/<feature>/<file>.ts` (interview / survey / workspace / notebooks / assistant / dashboard) | kebab-case |
| Auth helper | `lib/auth/<helper>.ts` | kebab-case |
| Test for a `lib/` file | sibling `__tests__/<topic>.test.ts` | mirror source filename |

**禁止** (binding):
- 新增 `lib/<file>.ts` 顶层文件. 如果不属于现有任何子目录, 先讨论该 feature 的边界, 再建新子目录.
- 顶层 `use-*.ts`. Hooks 必须在 `lib/hooks/`.
- 同一 resource 在 `queries/` 和 `actions/` 之外再开第三处 (例如不要在 `lib/server/notebooks.ts` 和 `lib/queries/notebooks.ts` 之外又开 `lib/notebooks.ts` 顶层文件 — 这是 P0 修过的歧义).
- `'use client'` 组件 import `lib/server/*` 或 `lib/queries/*` (server-only). 客户端只能 import `lib/hooks/` 和 client-safe util.

#### Drizzle/mock residue (known drift, do not touch)

| Path | Status |
|---|---|
| `lib/guide.ts` | v0 editor 编辑态层. 等 `survey-editor` sub-spec T3 把契约收敛到 `@merism/contracts`. |
| `lib/mock-session.ts` + `lib/mock/workspace.ts` | 给 `app/page.tsx` + `lib/hooks/use-interview-session.ts` 用的预览 fixture. 等 `interviewee-portal` sub-spec 用真 `useLiveInterview` 替换. |
| `lib/db/schema.ts` (study 表) | `analysis-report` sub-spec T8 已经删了 insight 表; 剩余 study 表等 `survey-editor` sub-spec 迁到 Appwrite. |
| `lib/actions/guide-ai.ts` | 同 `survey-editor` sub-spec. |

这些是**已知漂移**, AGENTS.md 这里登记后, 任何 PR 不应"顺手清理"它们 — 等指定 sub-spec 来替换. 但**也不应该**让新代码与它们耦合 (新 feature 不要 import `lib/guide.ts` 之类).

## Module-specific rules (binding)

### Path alias and imports
- Use `@/` alias (configured in `apps/web/components.json`) — never relative imports across feature boundaries (`../../components/...`).
- Cross-feature imports go via `@/components/<feature>/...` or `@/lib/...`. Within a single feature, relative imports are fine.

### Visual rules
- Every UI rule lives in `.kiro/steering/design-system.md` (Mauve Quiet). Read it before touching any component. Magic hex / direct font families / new icon libraries / black-fill buttons are forbidden.
- `lucide-react` is the only icon library. Figma payload SVGs may be downloaded to `public/figma/<asset>` when persistence is needed.
- Three-state Sidebar (Collapsed / Hover-Expanded overlay / Pinned) — never push-layout, never always-expanded. See `design-system.md` § Sidebar.

### State, data, and routing
- **Server-first**: prefer Server Components and route handlers for read paths. Use `lib/queries/` server-only fetchers.
- **Server actions** for write paths (`lib/actions/`). Never expose internal DB writes to the client.
- **TanStack Query** only when the surface genuinely needs live updates or optimistic UI. Default is server-fetch.
- **URL state** (search params) for filters / current selection. **Local UI state** in `useState`. **Cross-component shared state** via context — never module-level mutable singletons.
- **Forms**: React Hook Form + the corresponding zod schema from `@merism/contracts`. Never re-define field validation locally.
- **Realtime media**: LiveKit React SDK ONLY inside `components/interview/`. Never import LiveKit into editor / report / notebook surfaces.

### Auth model (binding)
- Researcher sessions: Appwrite Account via the client SDK. Session resolution flows through `lib/auth/` and `lib/owner.ts`.
- Anonymous interviewees: NEVER authenticate. They join via `issueLivekitToken` (server-issued short-lived JWT). Any client-side write that an anonymous user could trigger MUST go through a Function — direct Appwrite writes from `app/interview/*` are forbidden.

### Morris page assistant (binding)
- Backed by Vercel AI SDK 6 `ToolLoopAgent`. Model is DeepSeek (per ADR-0002).
- Tools live in `lib/assistant/tools/`. A tool MUST be an action on Merism data (create study draft, search interview data, list studies, ...). Conversational chat features are out of scope (`scope.md`).
- `app/api/assistant/route.ts` is the streaming entry. It MUST use `createAgentUIStreamResponse` and `prepareStep` for model/context/`toolChoice` switching, not a custom server-sent-events handler.
- Adding a tool: read existing tool layout + `prepareStep` examples in `vercel/ai` repo first (`pre-implementation.md`). Justify why it belongs in Morris vs a Function — every tool is duplicated work if the same effect is exposed via Function.

#### Tool metadata contract (binding, per `.kiro/specs/morris-tool-metadata/`)

每个 `tools/<name>.ts` 工具 builder 的 return 必须含 `metadata: ToolMetadata` 字段（参 `lib/assistant/tool-metadata.ts`）。规则：

1. **填齐 metadata**：`title` / `description` (≥ 120 字符, 含"做什么 / 何时用 / 关键参数怎么传") / `annotations` (`readOnly` + `destructive` + `idempotent` 三 boolean) / `requiredScopes` 数组 / 可选 `enrichUrl` 模板 / `type` (`read` / `write` / `draft` / `meta`) / `enabled` boolean。
2. **默认 `enabled: false`**：开放给 LLM 需在 PR 描述写明理由 + reviewer 显式批准。借鉴 PostHog `tools.yaml` 的"60% 默认禁用"哲学。
3. **destructive 自动走 approval**：`tools.ts::buildAssistantTools` 已用 `withApprovalGuard(name, metadata, execute)` 包装；不允许 builder 内部自调 `proposeApproval`（destructive 元数据驱动而非散落判断）。
4. **`enrichUrl` 模板需有 `{key}` 占位符**：纯静态 URL 应直接放在 Card 视觉里；`tool-results.tsx::EnrichLinkRow` 通过模板 + artifact 字段渲染统一的"打开"按钮。client-safe 镜像 `lib/assistant/tool-enrich-urls.ts` 必须与 builder 内的 metadata.enrichUrl 一致 — `metadata.test.ts::K-METADATA-09` 强制。
5. **同时注册到两处**：`buildAssistantTools` 与 `buildAssistantToolMetadata`；`metadata.test.ts::K-METADATA-01` 强制 keys 一致。

每个 `tools.ts::buildAssistantToolMetadata(ctx)` 返回的 manifest 视图给 `system-prompt.ts::buildToolsOverview(manifest)` 自动生成 `<tools_overview>` 段；改 metadata.title / description 首句, prompt 自动同步。

#### Conversation persistence (binding, per `.kiro/specs/morris-conversation-persistence/`)

Morris 对话**全部持久化到 Appwrite** (collection `conversations`), 关 dock / 刷新 / 跨 tab 都不丢:

1. **5 Server Actions** (`apps/web/lib/conversations/actions.ts`): `createConversation` / `saveMessages` / `listConversations` / `loadConversation` / `deleteConversation`. 每个入口 `getCurrentUserId()` 校验; doc 拉到后比对 `ownerUserId === currentUserId`, 不匹配 throw `not_authorized`.
2. **URL 契约**: `/assistant?conversationId=<id>` 加载该对话; 缺省时起始页. server-side `loadConversation` 在 RSC 跑, 第一次 paint 已 seed messages 不需要 client spinner. 跨 owner/不存在 → 静默回退到起始页 (不 404).
3. **useChat 接线**: `Conversation` 组件接 `initialMessages` + `onFinish: saveMessages`. 第一条消息时 `await createConversation()` 拿 id + `router.replace` 浅路由更新 URL (不 reflow). saveMessages 失败保留内存态 + 3s 重试一次, 仍失败显示"对话未保存" banner.
4. **Dock + standalone 共享 currentId**: `useCurrentConversationId` hook 用 `localStorage` + cross-tab `storage` event 同步. URL 是 standalone 的 source-of-truth (URL 优先于 storage).
5. **历史 UI**:
   - `ConversationHistory` 抽屉 (4 lifecycle: loading / error+retry / empty / loaded). 删除走 inline 二次确认 dialog (不用 browser `confirm()`)。dock + standalone 各自挂载.
   - `HistoryPreview` 起始页底部卡片 grid (compact 1 col / sm 2 cols), 空时 return null 不渲染.
6. **Title 自动生成**: saveMessages 在 `messageCount === 1 && title === ""` 时 fire-and-forget 调 `generateConversationTitle` (`withLLMCall(scope='morris.title.generate')` 包 generateText, 5-7 字简体中文).
7. **N+1 优化**: `listConversationsForOwner` 用 `Query.select(...)` 8 字段 (omit messagesJson) — 列表查询不拉重字段.
8. **AutoScroller**: `Conversation` 用 `stickyBottomRef` (PostHog `ThreadAutoScroller` 模式, 32px 阈值) — 用户上滑读历史时不被强制拉回底部, 仅当 scroll-locked-to-bottom 时新消息触发自动滚动.
9. **abortSignal 透传**: `route.ts` 传 `req.signal` 给 `createAgentUIStreamResponse` — `useChat.stop()` 真正取消 in-flight DeepSeek 调用 (不浪费 token).
10. **prompt-injection 防御**: `agent-context.ts::sanitizeField` 在注入 system prompt 前 strip `< > { }` + 折叠换行, 防 user 名 / 邮箱意外破坏 `<agent_context>` tag.

#### Feedback prompt + cross-component invalidation (binding)

**Feedback (thumbs up/down)**:
- 每条 assistant message 渲染下方挂 `<FeedbackButtons conversationId={currentId} messageId={message.id} />` (`apps/web/components/assistant/feedback-buttons.tsx`).
- 5 phase lifecycle: `idle → submitting → rated_up | rated_down | rating_down_text → rated_down`. group-hover 浮现, 点击即提交 (up 直接, down 提示可选 textarea).
- Server Action `submitFeedback` (`apps/web/lib/conversations/feedback.ts`): observability-only — 当前 `logger.info("morris.feedback", {conversationId, messageId, rating, hasText, textLength, ownerUserId})` 不持久化. 持久化到 `morris_feedback` collection 留单独 sub-spec (cohort eval 阶段需要时再做).
- `conversationId === null` 时 FeedbackButtons return null — 没持久化的 conversation 不收 feedback 信号.

**Cross-component invalidation** (`use-conversation-invalidate.ts`):
- 模式: process-local `EventTarget` bus + `invalidateConversations()` producer + `useOnConversationsInvalidate(cb)` consumer hook. 借鉴 PostHog kea logic listener 模式但不引入 zustand/jotai.
- Producers (调用点): `Conversation.submit` 第一次 createConversation 后 / `Conversation.onFinish` saveMessages 后 (title 可能变了) / `dock.startNewConversation` / `scene-shell.handleNewConversation` / `ConversationHistory.handleConfirmDelete`.
- Consumers (订阅): `ConversationHistory` + `HistoryPreview` 各自 `useEffect(load)` 后注册 `useOnConversationsInvalidate(reload)`. 任何 producer fire 都触发 reload — dock 删完 standalone 自动刷.
- 没有它: 两边各拉一次 listConversations, 永远显示 stale state.

#### Long-term memory (binding, per `.kiro/specs/morris-memory/`)

Morris 跨对话**记得**用户偏好 / 业务背景 / 技术约束 (Appwrite `morris_memories`):

1. **Tool**: `manageMemories` 5-action discriminated union (create / query / update / delete / list). LLM 主动调用 — 用户透露关键事实先 query 看是否已存, 不存则 create. system prompt `<workstyle>` 第 6 条 binding 指引这个行为.
2. **System prompt 接入**: route.ts 启动时 `listMemories({limit: 20})` 与 `buildAgentContext()` Promise.all 并行拉, 渲染到 `<long_term_memory>` 段 (failure → 段省略, 向后兼容).
3. **Embedding**: 复用 `lib/server/embedder-qwen` (Qwen text-embedding-v3, 1024-dim, 与 Notebook 同). create/update fire-and-forget `embedAndSaveMemory`. query 时 in-memory cosine 排序 (< 200 memories/user); 失败 → fulltext fallback `Query.search("content", queryText)`, response 标 `fallback: "embedding-error" | "scale-fulltext-only"`.
4. **Owner isolation**: 与 Conversation/Notebook 同 `OWNER_SCOPED + documentSecurity`. 每个 action 入口 `getCurrentUserId()` + 后比对 `ownerUserId === currentUserId` (cross-owner throw not_authorized). PBT P-MEM-02 强制.
5. **Schema invariants**: `metadataKeys === Object.keys(metadata).sort()` (zod superRefine + PBT P-MEM-03 强制); embedding 1024-dim 严格 (K-MEM-03); content 1-4000 字符; metadataKeys 上限 16.
6. **destructive 折中** (per design.md §10.6): tool 整体 `destructive: false` 让 readOnly query/list 不被 over-approved; `delete` action 当前直接执行 (待 morris-tool-metadata Wave 2 引 per-action destructive 后接 approval).
7. **不做** (留下次 sub-spec): 用户面板 /memories 编辑 UI / Memory 编辑 history / archival / TTL.

#### LLM call observability (binding, per `.kiro/specs/morris-llm-observability/`)

Morris 内部所有 LLM 调用必须经过 observability 层：

1. **`apps/web/lib/assistant/model.ts::CHAT_MODEL` / `REASONING_MODEL`** 已用 `wrapLanguageModel({middleware: llmObservabilityMiddleware(...)})` 包过。ToolLoopAgent 内部每个 step 的 LLM 调用都自动走 middleware，scope = `morris.toolloop` / `morris.toolloop.reasoner`，每个 step 记一条 `LLMCallEvent`。
2. **compaction.ts::summarizeMessages**, **actions/notebooks.ts::createNotebook**, **actions/guide-ai.ts** 用显式 `withLLMCall({scope, traceId, defaultModel}, () => generateText(...))` 包。scope 命名规范见 `.kiro/steering/errors-and-observability.md::LLM call observability`。
3. **双 event 现象**：compaction 调用既经过 middleware (scope=`morris.toolloop`) 又经过显式 wrap (scope=`morris.compaction.summarize`)，写两条 event。**by design** — 让日志既看到"哪个调用点"又看到"哪个 model"。去重在日志查询层做。
4. **新加 LLM 调用 site**：必须用上述两种方式之一接入 + 同步登记到 `errors-and-observability.md::LLM call observability::Wave B 接入清单` 表。直接 `await generateText(...)` 而不经过 wrapper 是 forbidden — `pnpm test` 不会抓出来，但 review 必须 reject。
5. **不要写 prompt / completion 进 event**：`LLMCallEvent` schema 已经把它排除掉。debug snippet 路径仅 `MERISM_DEBUG_PROVIDERS=1` 启用，截首 200 字符。

### Drizzle/Postgres legacy (binding)
- The current `lib/db/`, `lib/guide.ts`, `lib/actions/guide-ai.ts`, and `components/studies/*` use Drizzle on Postgres. This is **drift** from the v0 generation. The architectural target is Appwrite-only.
- DO NOT add new collections, models, or queries to `lib/db/`. New persistence belongs in `packages/appwrite-schema` + a Function.
- The remaining `study` table will be removed by the `survey-editor` sub-spec. Until then, treat existing usage as read-only fixture for the editor preview.

### Error boundaries
- Render errors MUST surface to a Next.js `error.tsx` boundary with the `traceId` passed to logging — never `try { ... } catch { return null }` inside a component.
- Server actions MUST return `{ ok: true, data } | { ok: false, error: "<code>", traceId }` matching the Function shape (see `errors-and-observability.md`). Map error codes to user-visible copy in the calling component, not at the boundary.

## Cross-module change triggers

| If you change | You MUST also update |
|---|---|
| The `merism.interviewState` participant attribute consumed by `lib/use-live-interview.ts` | `packages/contracts/src/state.ts` (`InterviewAgentState`) AND `apps/agent/agent/interview/supervisor.py` `_publish_state(...)` |
| A Server Action that writes Appwrite | The corresponding zod request schema in `packages/contracts/src/api.ts` AND a Function if anonymous users could trigger it |
| Morris tool input/output | The tool registry in `lib/assistant/tools/` AND the corresponding contract in `packages/contracts` if the result crosses persistence |
| Token issuance flow | `apps/functions/issueLivekitToken` AND the `lib/issue-token.ts` caller AND `lib/use-interview-bootstrap.ts` |
| Sidebar / button / form primitives | `.kiro/steering/design-system.md` first — visual updates start in steering, then Figma, then code (per design-system.md "Update Procedure") |

## Anti-patterns specific to this app

- Direct Appwrite SDK writes from a client component for an action an anonymous interviewee could trigger. Always go via a Function.
- `lib/db/` additions (Drizzle/Postgres). The architectural target is Appwrite.
- `font-['Inter']` or any direct font family class. Use semantic `font-display` / `font-reading` / `font-ui` / `font-data` / `font-decor` / `font-doc-link`.
- Raw hex colors in components. Use design tokens (`text-ink-900`, `bg-mauve-200`, etc.).
- `try { await fetch(...) } catch { return [] }` to "make TypeScript happy" — that masks data-source failures. Bubble up via error boundary or return a typed error.
- Importing LiveKit React SDK outside `components/interview/` or `lib/use-live-interview.ts` / `lib/interview-transport.ts` / `lib/use-interview-bootstrap.ts`.
- A new icon library beyond `lucide-react`.
- Mixing server and client concerns: importing `lib/server/*` in a `'use client'` file, or putting `process.env` inside a client component.

## Enforcement (per-module)

```bash
# Workspace-level commands cover apps/web; from repo root:
pnpm dev                      # Next.js dev server
pnpm build                    # Build all packages including apps/web
pnpm typecheck                # tsc --noEmit
pnpm lint                     # eslint
pnpm test                     # vitest across the workspace, includes apps/web/lib/__tests__
pnpm e2e                      # Playwright end-to-end (requires running stack)

# Visual smoke checks against design-system.md when touching components:
# 1. font-* and bg-* / text-* tokens are semantic — no hex, no font-['Family'].
# 2. Three-state Sidebar still defaults to Collapsed.
# 3. No black-filled solid buttons in product UI.

# Confirm no Drizzle additions outside lib/db/:
grep -RIn 'from "drizzle-orm"' apps/web/lib apps/web/components apps/web/app | grep -v 'apps/web/lib/db/' && echo "VIOLATION: Drizzle import outside lib/db/"
```

A UI change without a side-by-side compare against the corresponding Figma node (per `design-system.md` Figma MCP rules) is not ready to merge.

## Known foot-guns

Concrete pitfalls observed in this codebase. Add a new entry here every time a non-trivial bug is fixed in this module — this is how the file stays useful.

### `use-interview-session.ts` (mock) vs `use-live-interview.ts` (real LiveKit)

These two hooks have similar names and similar shapes but very different sources:

- `lib/use-interview-session.ts` is the **mock** session driver backed by `lib/mock-session.ts`. It powers the structured-question rendering preview on `app/page.tsx`. It will be **removed** by the `interviewee-portal` sub-spec.
- `lib/use-live-interview.ts` is the **real** LiveKit consumer. It reads `merism.interviewState` participant attribute published by the Python supervisor and maps it to UI state.

Importing the wrong one in a new component produces a UI that "works in dev" (mock data flows) but never receives any updates from a real interview. **Rule**: any new code under `app/interview/*` or `components/interview/*` MUST use `use-live-interview`. The `use-interview-session` mock is for the legacy demo page only and should not spread.

### `lib/db/` is Drizzle/Postgres legacy — do not extend it

`lib/db/schema.ts` and the surrounding `lib/guide.ts` / `lib/actions/guide-ai.ts` / `components/studies/*` came from a v0-generated editor draft. The `study` table is the only thing left after the `analysis-report` sub-spec removed `insight`. The `survey-editor` sub-spec will remove the rest.

**Rule**: do not add new tables, queries, or actions to `lib/db/`. New persistence belongs in `packages/appwrite-schema` + a Function. If a current Drizzle path is in your way, port it to Appwrite as part of your PR rather than extending the legacy.

### `try { await fetch(...) } catch { return [] }` masks production breakage

A frequently-tempting pattern in `lib/queries/*` is to wrap a fetch in try/catch and return an empty list on failure to "make the UI not crash". This hides production breakage — researchers see an empty dashboard with no error banner and assume "I have no data" rather than "the server is down".

**Rule**: read paths surface failures via Next.js `error.tsx` boundaries, with `traceId` flowing into the logged error. Write paths return `{ ok: false, error: "<code>", traceId }` from server actions; the calling component maps codes to user-facing copy. Never silently swallow a fetch failure as "no data".

### Importing `lib/server/*` in a `'use client'` file

Files under `lib/server/` use `process.env`, secrets, or server-only APIs (e.g. Appwrite admin client). Importing them from a client component compiles but will leak server-only modules into the client bundle and almost always fail at runtime with cryptic errors ("can't find env var X") that do not point at the import.

**Detection**: ESLint rule `react-server-components/no-server-import-in-client` should flag this. If it doesn't, add an explicit comment ban at the top of the offending file. When in doubt, prefer `lib/queries/` (server fetcher) + Server Component, never `'use client' + lib/server/*`.

### `font-['Inter']` and raw hex colors compile and "look fine"

A direct Tailwind family class (`font-['Inter']`) or a raw hex (`text-[#0F172A]`) compiles without warning and renders identically to the design-token version on the developer's machine. The drift surfaces only when `design-system.md` evolves — the hex stays frozen, the design system moves.

**Rule**: every UI change must use semantic tokens (`font-display` / `font-reading` / `font-ui` / `font-data` / `font-decor` / `font-doc-link` and `text-ink-900` / `bg-mauve-200` / etc.). Reviewers check this; future tooling should add an ESLint rule banning `font-\[` and `text-\[#`.

### 漏填工具 metadata 会被 K-METADATA-01 拦截

新增 Morris 工具时只在 `tools/<name>.ts` 写了 `metadata` 但忘了在 `tools.ts::buildAssistantToolMetadata` 注册（或反之），`pnpm test` 会失败于 `metadata.test.ts::K-METADATA-01` 给出 `expected ['createX', 'foo', ...] to equal ['createY', 'foo', ...]`，从 diff 里能直接看到漏掉或多出的 toolName。

类似地，改了 `tools/<name>.ts` 里的 `metadata.enrichUrl` 但忘了同步 `lib/assistant/tool-enrich-urls.ts` 客户端镜像，会失败于 `K-METADATA-09` 报 "TOOL_ENRICH_URLS[name] drifted from manifest.enrichUrl"。

**Fix**：补全 `tools.ts` 的两个聚合函数 + 同步 `tool-enrich-urls.ts`；不要绕过单测让 LLM 看不到的"幽灵工具"或客户端 URL 漂移。

### 漏填工具 metadata 会被 K-METADATA-01 拦截

新增 Morris 工具时只在 `tools/<name>.ts` 写了 `metadata` 但忘了在 `tools.ts::buildAssistantToolMetadata` 注册（或反之），`pnpm test` 会失败于 `metadata.test.ts::K-METADATA-01` 给出 `expected ['createX', 'foo', ...] to equal ['createY', 'foo', ...]`，从 diff 里能直接看到漏掉或多出的 toolName。

类似地，改了 `tools/<name>.ts` 里的 `metadata.enrichUrl` 但忘了同步 `lib/assistant/tool-enrich-urls.ts` 客户端镜像，会失败于 `K-METADATA-09` 报 "TOOL_ENRICH_URLS[name] drifted from manifest.enrichUrl"。

**Fix**：补全 `tools.ts` 的两个聚合函数 + 同步 `tool-enrich-urls.ts`；不要绕过单测让 LLM 看不到的"幽灵工具"或客户端 URL 漂移。
