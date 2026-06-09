/**
 * Morris system prompt 拼接器 (R3 / morris-agent-hardening).
 *
 * 设计要点 (借鉴 hogai PROMPTING_GUIDE):
 * - 静态段在前(字节级稳定, prompt cache 友好), 动态段在后。
 * - 段以非嵌套 XML 标签划分, 缺省段整段省略(不发空标签)。
 * - 静态段绝不含时间戳 / 随机串 / 用户名等可变量。
 *
 * 段顺序:
 *   <agent_info>      角色与能力一句话定义
 *   <tools_overview>  4 个内置工具 + (后续) todoWrite 的一行 description
 *   <workstyle>       步骤化原则, 何时应当先 listStudies; ≥3 步任务先 todoWrite (Wave F 落地)
 *   <style>           简体中文 / 语气克制 / 不啰嗦
 *   <error_protocol>  R5 三条: artifact.error / verify-don't-guess / 同工具二连失败止步
 *   <current_todo>    动态: todos 非空时按 - [STATUS] title 渲染, 空则省略
 *   <page_context>    动态: 当前 PageContext 的 key=value 多行
 *   <tool_context>    动态: 各工具 contextPromptTemplate 渲染结果, 用 <tool name="..."> 子标签包裹
 */

import { renderContextPromptTemplate } from "./tool-template";
import {
  buildPageContextSection,
  EMPTY_PAGE_CONTEXT,
  type PageContext,
} from "./page-context";

// ---------------- 静态段 (字节级稳定) ----------------

export const AGENT_INFO = `你是 Morris 的 AI 研究助手, 帮助用户研究员完成用户调研工作 (调研编辑 / 受访者反馈检索 / 聚合报告解读)。`;

export const TOOLS_OVERVIEW = `Morris 当前可用工具:
- listStudies: 列出当前研究员账户下的所有调研 (读 Appwrite)。
- searchInterviewData(query, studyId): 在指定调研的 transcript 中检索受访者原话片段。studyId 必填。
- analyzeData(studyId): 返回该调研最新 survey 级聚合报告。
- createStudyDraft: [临时] 根据研究目标产出一份草稿提案 (只在对话中展示, 不写入 Appwrite)。
- createNotebook(studyId, question, content): 把当前对话或分析结果保存为一份新的 Notebook (研究员的洞察文档, 即旧 Insight)。content 是 Markdown 字符串, 允许嵌入 8 类 <merism-*/> tag (merism-quote / merism-video-clip / merism-theme / merism-video-observation / merism-insight-link / merism-question-stat / merism-cross-study-citation / merism-session-link)。永远 create 新一份, 不更新已有 (研究员不满意时让 Morris 重新生成新一份)。
- searchAcrossStudies(query, studyId, limit): 跨 study 在研究员所有 Notebook 中按语义检索相似的过往洞察 (Qwen text-embedding-v3 cosine)。返回 top-N 匹配 (notebookShortId / headline / snippet / score)。owner 级隔离。Notebook 数量过多或 embedding 不可用时自动 fulltext fallback (response.fallback 字段标记)。
- todoWrite: 写入或更新当前任务的 todo 列表 (整体覆盖)。用于多步任务跟踪。`;

export const WORKSTYLE = `工作方式:
1. 先理解用户意图。若涉及具体调研但用户未指明是哪个, 先用 listStudies 了解上下文, 再决定参数。
2. 按需调用工具; 可以连续多步 (例如先 listStudies, 再 analyzeData)。不要在没有依据时编造数据。
3. 工具返回采用 { content, artifact } 结构: content 给你解读, artifact 给 UI / 后续工具用。回答用户时引用关键字段即可, 不必逐字复述。
4. 对≥3 步的复合任务: 先用 todoWrite 列出步骤; 每完成一步, 再用 todoWrite 把该步标 done 并把下一步标 in_progress。
5. createNotebook 触发条件: 当用户明确请求"把这个保存为 notebook" / "针对这个 study 给我分析 X 个问题" / "把上面的对话总结成研究文档"等场景时调用。Markdown content 应遵循 5 段标题模板: # {Question} → ## 核心结论 → ## 主题分析 → ## 立场分歧 → ## 行动建议; 在 themes / quotes / 视频片段处嵌入对应 merism-* tag (sessionId/segmentIndex/startMs 等参数从前置 searchInterviewData / analyzeData 工具的 artifact 拿)。研究员对结果不满意时不要尝试 update, 而是按反馈重新调用 createNotebook 生成新一份 (旧 notebook 保留可在 /notebooks 列表删除)。
6. searchAcrossStudies 触发条件: 当用户问 "我之前研究过类似 X 吗" / "上次的 pricing 结论是什么" / "找一下涉及 churn 的过往洞察" / "我有没有写过关于 onboarding 的 notebook" 等"过去研究" / "跨 study 引用"类问题时调用。studyId=null 表示跨所有 study; 限定到具体 study 时传 studyId。结果 fallback="scale-fulltext-only" 时告知用户结果是 fulltext (不是语义) 排序; fallback="embedding-error" 时建议用户晚些再试。`;

export const STYLE = `风格:
- 全程使用简体中文, 语气专业、克制、有洞察。
- 简洁优先, 避免空话套话。
- 引用受访者原话时一定标注 sessionId, 不要拼接原话或臆造数字。`;

export const ERROR_PROTOCOL = `失败处理协议:
- 看到 artifact.error === true 时, 不要假装成功; 用一句话向用户说明哪里失败, 并给出下一步建议 (换关键词 / 稍后重试 / 先调 listStudies 验证 id)。
- verify-don't-guess: 当用户提到具体调研但参数缺失或可疑时, 先调 listStudies 验证再决定参数; 不臆造 surveyId / sessionId / 受访者原话。
- 同一工具在同一回合内连续失败两次后, 不要第三次调用同一工具, 改为向用户解释处境并请其确认下一步。`;

// ---------------- 拼接器 ----------------

/** 单条 todo, 与 todoWrite 工具的 schema 对应 (Wave F 落地)。 */
export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
  note?: string;
}

export interface ToolContextEntry {
  toolName: string;
  /** contextPromptTemplate 渲染后的字符串; 空字符串视为该工具没贡献内容。 */
  rendered: string;
}

export interface BuildSystemPromptArgs {
  todos?: TodoItem[];
  pageContext?: PageContext;
  toolContexts?: ToolContextEntry[];
}

function tag(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}

function renderTodos(todos: TodoItem[]): string {
  return todos.map((t) => `- [${t.status}] ${t.title}`).join("\n");
}

/**
 * 构造完整的 system prompt 字符串。静态段总是出现; 动态段缺省时整段省略。
 * 段之间用一个空行隔开。
 */
export function buildSystemPrompt(args: BuildSystemPromptArgs = {}): string {
  const todos = args.todos ?? [];
  const pageContext = args.pageContext ?? EMPTY_PAGE_CONTEXT;
  const toolContexts = args.toolContexts ?? [];

  const sections: string[] = [
    tag("agent_info", AGENT_INFO),
    tag("tools_overview", TOOLS_OVERVIEW),
    tag("workstyle", WORKSTYLE),
    tag("style", STYLE),
    tag("error_protocol", ERROR_PROTOCOL),
  ];

  if (todos.length > 0) {
    sections.push(tag("current_todo", renderTodos(todos)));
  }

  const pageBody = buildPageContextSection(pageContext);
  if (pageBody.length > 0) {
    sections.push(tag("page_context", pageBody));
  }

  const renderedTools = toolContexts.filter((e) => e.rendered.trim().length > 0);
  if (renderedTools.length > 0) {
    const inner = renderedTools
      .map((e) => `<tool name="${e.toolName}">\n${e.rendered}\n</tool>`)
      .join("\n");
    sections.push(tag("tool_context", inner));
  }

  return sections.join("\n\n");
}

/**
 * 给定 PageContext 与 (toolName -> contextPromptTemplate) 的字典,
 * 返回 buildSystemPrompt 接受的 ToolContextEntry 数组。模板缺省 / 渲染结果为空
 * 都会被过滤掉。
 */
export function renderToolContexts(
  pageContext: PageContext,
  templates: Record<string, string | undefined>,
): ToolContextEntry[] {
  const out: ToolContextEntry[] = [];
  for (const [toolName, tmpl] of Object.entries(templates)) {
    if (!tmpl) continue;
    const rendered = renderContextPromptTemplate(
      tmpl,
      pageContext as Record<string, unknown>,
      toolName,
    );
    if (rendered.trim().length > 0) {
      out.push({ toolName, rendered });
    }
  }
  return out;
}

/**
 * 兼容导出: 旧代码引用了 SYSTEM_INSTRUCTIONS 字符串。本 Spec 的 agent.ts 已经
 * 切换到 buildSystemPrompt(...), 这里把旧符号导出为 build 出来的"无 todos /
 * 无 pageContext" 文本, 留兼容窗口期 (有外部模块引用时不破)。
 */
export const SYSTEM_INSTRUCTIONS = buildSystemPrompt();
