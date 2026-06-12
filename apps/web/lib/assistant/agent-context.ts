/**
 * Morris agent runtime context — 借鉴 PostHog `MaxChatOpenAI._enrich_messages`
 * 与 `PROJECT_ORG_USER_CONTEXT_PROMPT` (ee/hogai/llm.py) 的形态. 我们只借形态:
 * 实现是 TS 纯函数 + Appwrite Account.get, 不引入 LangChain, 不跨 module.
 *
 * 把 "今天是几号 / 你是哪位研究员 / Merism 的 URL 怎么写" 自动注入到 system prompt
 * 的 <agent_context> 段, 让 LLM 永远不必从对话历史里重推这些事实.
 *
 * 设计取舍:
 * - 无 contracts 改动 (`scope.md`: 纯 web app 内动态段, 不跨 module 持久化).
 * - 无新 env flag (`errors-and-observability.md::Feature flags`).
 * - 时间渲染到分钟而不是秒, 避免 prompt cache 在每个 token 都失效;
 *   分钟级精度足够 LLM 推断"现在几点 / 今天几号"。
 * - 时区固定 Asia/Shanghai (UTC+8) 使本地开发与生产输出一致, 不依赖 host 时区。
 * - `getCurrentUserProfile` 用**懒加载**: agent-context.ts 被 system-prompt.ts /
 *   agent.ts 静态依赖, 这些 module 也被多个 vitest 测试加载. 静态导入会把
 *   `next/headers` 与 `node-appwrite` 拉进每个测试的 module graph (与 server-only
 *   边界不符, 也强制每个测试都要 mock @/lib/queries/auth)。改成 lazy 后只有
 *   真正调用 buildAgentContext 时才进入 Appwrite 路径。
 */

export interface AgentContext {
  /** 项目代号, 固定 "MerismV2"。 */
  projectName: string;
  /** 研究员姓名; 未登录或 Account.get 失败时退化为 "研究员"。 */
  userFullName: string;
  /** 研究员邮箱, 可缺。 */
  userEmail?: string;
  /** "YYYY-MM-DD HH:mm (UTC+8)" 字面量, 见 formatChinaDateTime。 */
  currentDateTime: string;
  /** Merism URL 引用规则; 由静态常量 URL_PATTERNS 提供, 字节稳定。 */
  urlPatterns: string;
}

const PROJECT_NAME = "MerismV2";
const FALLBACK_USER_NAME = "研究员";

/**
 * Merism 内部 URL 模式说明. 静态字符串 (字节稳定 → prompt cache 友好的部分)。
 *
 * 借鉴 PostHog PROJECT_ORG_USER_CONTEXT_PROMPT 中 "Key URL patterns" 段落,
 * 但路径列表是 Merism 自己的。新增页面路由时同步这里。
 */
export const URL_PATTERNS = `URL 引用规则:
- 调研: /studies/<studyId>
- 受访者会话: /sessions/<sessionId>
- 分析报告: /reports/<surveyId>
- 笔记: /notebooks/<notebookShortId>
- 助手: /assistant?conversationId=<id>
所有 URL 用根相对路径 (/ 开头), 不写完整域名. 用 Markdown 链接形式: [显示文本](/path).`;

/**
 * 构造当前对话的 AgentContext. 服务端 only (依赖 cookie session)。
 *
 * 任意失败路径退化, 不抛错:
 *   - 未登录 → userFullName="研究员", 无 userEmail
 *   - Appwrite 不可用 / Account.get 抛 → 同上
 *
 * @param now 注入时间, 主要给单元测试用; 默认 `new Date()`。
 */
export async function buildAgentContext(now: Date = new Date()): Promise<AgentContext> {
  // Lazy import keeps server-only deps (next/headers, node-appwrite) out of
  // the static module graph for transitive importers / vitest module loads.
  const { getCurrentUserProfile } = await import("@/lib/queries/auth");
  const profile = await getCurrentUserProfile();
  const trimmedName = profile?.name?.trim();
  const trimmedEmail = profile?.email?.trim();
  return {
    projectName: PROJECT_NAME,
    userFullName: trimmedName && trimmedName.length > 0 ? trimmedName : FALLBACK_USER_NAME,
    userEmail: trimmedEmail && trimmedEmail.length > 0 ? trimmedEmail : undefined,
    currentDateTime: formatChinaDateTime(now),
    urlPatterns: URL_PATTERNS,
  };
}

/**
 * 把 AgentContext 渲染为进入 system prompt 的纯文本块。
 * buildSystemPrompt 把这块包进 <agent_context>...</agent_context>。
 */
/**
 * Sanitize untrusted strings before injection into the system prompt.
 *
 * The agent_context section is built from runtime state (user name, email,
 * project name) — these are *not* attacker-controlled in our auth model
 * (the user IS the researcher who set their own name) but we still defend
 * against accidental tag-closure / prompt-injection from copy-pasted names:
 *
 *   - strip < > to prevent closing the </agent_context> XML tag
 *   - strip { } to prevent breaking Mustache templates downstream
 *   - replace newlines with spaces so a multi-line "name" can't inject
 *     instructions on a fresh line
 *   - cap to MAX_FIELD_LENGTH characters
 *
 * If a runtime field becomes empty after sanitization we fall back to a
 * generic placeholder rather than emit an empty bullet.
 */
const MAX_FIELD_LENGTH = 200;
function sanitizeField(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>{}]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
  return cleaned || fallback;
}

export function renderAgentContext(ctx: AgentContext): string {
  const safeName = sanitizeField(ctx.userFullName, "研究员");
  const safeEmail = ctx.userEmail
    ? sanitizeField(ctx.userEmail, "")
    : undefined;
  const safeProject = sanitizeField(ctx.projectName, "MerismV2");
  const safeDateTime = sanitizeField(ctx.currentDateTime, "");
  const researcherLine = safeEmail
    ? `- 研究员: ${safeName} (${safeEmail})`
    : `- 研究员: ${safeName}`;
  return [
    "当前 Merism 项目环境:",
    `- 项目: ${safeProject}`,
    researcherLine,
    `- 当前时间: ${safeDateTime}`,
    "",
    ctx.urlPatterns,
  ].join("\n");
}

/**
 * 把 Date 渲染成 "YYYY-MM-DD HH:mm (UTC+8)"。
 *
 * 不读 host 时区: 用 Intl.DateTimeFormat 强制 Asia/Shanghai, 保证本地开发与
 * 部署环境输出一致 (避免 LLM 看到 "2026-06-11 05:17 (UTC+8)" 这种 host=UTC 的
 * 错位结果)。en-CA locale 给 "YYYY-MM-DD" 形态。
 */
function formatChinaDateTime(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // ICU 在某些版本会把 24h 渲染为 "24" 而非 "00"; 兜底保证 LLM 看到的是 "00:..".
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? "00" : hourRaw;
  const time = `${hour}:${get("minute")}`;
  return `${date} ${time} (UTC+8)`;
}
