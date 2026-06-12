# Subagent B 工作单 — Agent context auto-injection (P1-1)

## 任务边界

把当前研究员 / 项目 / 时间 / URL 模式上下文**自动注入**到 Morris system prompt, 让 LLM 永远知道 "今天是几号" / "你是哪个研究员" / "URL 怎么写". 借鉴 PostHog `MaxChatOpenAI` + `PROJECT_ORG_USER_CONTEXT_PROMPT` 的形态.

**不做** (拆出去的 / 别人做的):
- 持久化 conversation (subagent A 在做)
- Stop/Abort / Slash commands (subagent C 在做)
- Memory 长期记忆 (留下个 sub-spec)

## 必读

1. `.kiro/steering/architecture.md` — 模块边界
2. `.kiro/steering/contracts.md` — 不引入新 contract; 只改 prompt
3. `.kiro/steering/errors-and-observability.md::LLM call observability` — 用 createLogger
4. `apps/web/lib/assistant/system-prompt.ts` — 当前 system prompt 拼接器, 你要改这里
5. `apps/web/lib/queries/auth.ts` — `getCurrentUserId()` 拿当前研究员 (是否还有 getCurrentUser 拿 name? 自己查)
6. `/home/jia/posthog/ee/hogai/llm.py::PROJECT_ORG_USER_CONTEXT_PROMPT` (本地 PostHog clone) — 借鉴这个段的形态

## 工作内容 (4 文件改动)

### 1. 新建 `apps/web/lib/assistant/agent-context.ts`

```typescript
/**
 * Morris agent runtime context — 借鉴 PostHog MaxChatOpenAI._enrich_messages
 * 但只借**形态**, 实现是 TS 纯函数.
 */
import { getCurrentUser } from "@/lib/queries/auth"; // 自己确认这个 helper 存在 + 拿 name + email; 不在就调 getCurrentUserId 后查 Appwrite Account.get

export interface AgentContext {
  projectName: string;     // 固定 "MerismV2"
  userFullName: string;    // 研究员姓名, 没拿到则 "研究员"
  userEmail?: string;      // 可选
  currentDateTime: string; // ISO 8601 + 中国时区, 例如 "2026-06-11 13:00 (UTC+8)"
  urlPatterns: string;     // 静态 — Merism 内部 URL 模式说明 (见下)
}

export async function buildAgentContext(): Promise<AgentContext> {
  // ...
}

export function renderAgentContext(ctx: AgentContext): string {
  return `当前 Merism 项目环境:
- 项目: ${ctx.projectName}
- 研究员: ${ctx.userFullName}${ctx.userEmail ? ` (${ctx.userEmail})` : ""}
- 当前时间: ${ctx.currentDateTime}

${ctx.urlPatterns}`;
}

export const URL_PATTERNS = `URL 引用规则:
- 调研: /studies/<studyId>
- 受访者会话: /sessions/<sessionId>
- 分析报告: /reports/<surveyId>
- 笔记: /notebooks/<notebookShortId>
- 助手: /assistant?conversationId=<id>
所有 URL 用根相对路径 (/ 开头), 不写完整域名. 用 Markdown 链接形式: [显示文本](/path).`;
```

### 2. 改 `apps/web/lib/assistant/system-prompt.ts`

- `BuildSystemPromptArgs` 接口加可选 `agentContext?: AgentContext`
- `buildSystemPrompt` 实现里, sections 数组在 `tag("agent_info", ...)` 之后立即加 `tag("agent_context", renderAgentContext(args.agentContext))` (仅当提供时)
- 注意: 静态段在前, agent_context 是动态段 (含时间), 所以放在静态段后面 — 和 prompt cache 友好原则一致 (动态尾部)

实际上**重新读** PROMPTING_GUIDE 的 prompt cache 规则: 静态在前, 动态在后. 我们 agent_context 含 currentDateTime 是变动的, 所以放在最末是最好的. 但放在 agent_info 之后, todos / pageContext / tool_context 之前也可以. 自己 design 决定 + 写注释解释为什么.

### 3. 改 `apps/web/lib/assistant/agent.ts::buildMorrisAgent`

- 接收新 `agentContext: AgentContext` (可选; 缺省时不注入)
- 把 agentContext 传给 `buildSystemPrompt({ ..., agentContext })`

### 4. 改 `apps/web/app/api/assistant/route.ts`

- 在 buildMorrisAgent 之前 `await buildAgentContext()` 拿 context
- 传给 buildMorrisAgent

### 5. 单元测试 `apps/web/lib/assistant/__tests__/agent-context.test.ts`

≥ 6 用例:
- buildAgentContext: 返回 projectName="MerismV2"
- buildAgentContext: 含 userFullName, 没登录时 "研究员"
- buildAgentContext: currentDateTime 是 ISO + UTC+8 时区格式
- renderAgentContext: 完整渲染输出含 4 个 key
- buildSystemPrompt: 含 agentContext 时 <agent_context> 段在 <agent_info> 之后
- buildSystemPrompt: 不传 agentContext 时不渲染 <agent_context> 段 (向后兼容)

## 写文档/代码 fallback 规则

如果 write 工具失败/被取消:
- 用 `cat > file << 'EOF' ... EOF` heredoc 创建文件
- 用 `cat >> file << 'EOF' ... EOF` 追加 (内容长分段)
- 用 `python3 -c "..."` 或 `python3 << 'PYEOF' ... PYEOF` 做小规模 in-place patch (开 file, replace, write)
- 用 `sed -i 's/old/new/' file` 简单替换

## 验收

- `pnpm -F web typecheck` Done
- `pnpm vitest run apps/web/lib/assistant/__tests__/agent-context.test.ts` 6+ 用例全绿
- `pnpm vitest run apps/web/lib/assistant` 全绿 (现有测试不破坏)
- 手动: 起 dev server, /api/assistant 收到 request 时 logger 应该看到 buildAgentContext 被调一次

## 不做的

- 不引入 LangChain (我们是 Vercel AI SDK 6)
- 不改 contracts (这个改动纯 web app 内, 不跨 module)
- 不改 morris-llm-observability 的 scope 命名
- 不引入新 env flag — 全部走运行时 query
