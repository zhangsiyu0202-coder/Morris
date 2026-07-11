import { z } from "zod";

/**
 * 客户端在 useChat body 提交的 PageContext。strict() 防止前端 bug 或恶意脚本
 * 把未声明字段塞进 prompt (这是 LLM 数据外泄的攻击面)。新增字段必须改 schema。
 *
 * 渲染时:
 * - 字符串/数字/布尔 → String(value)
 * - 数组/对象 → JSON.stringify(value)
 * - 缺省 → 跳过该字段 (不输出 "key=None"; 那是 contextPromptTemplate 的语义)
 */
export const PageContextSchema = z
  .object({
    path: z.string().max(256).optional(),
    surveyId: z.string().max(64).optional(),
    sessionId: z.string().max(64).optional(),
    recentSessionIds: z.array(z.string().max(64)).max(8).optional(),
    selectedSegmentIds: z.array(z.string().max(64)).max(32).optional(),
  })
  .strict();

export type PageContext = z.infer<typeof PageContextSchema>;

export const EMPTY_PAGE_CONTEXT: PageContext = Object.freeze({}) as PageContext;

/**
 * 把 PageContext 渲染为 system prompt 中 `<page_context>` 段的纯文本内容。
 * 全部字段缺省 → 返回 ""(供拼接器整段省略)。
 *
 * 仅对 Schema 已声明的 key 输出, 多余字段被 strict 拒绝在 schema 解析阶段。
 */
export function buildPageContextSection(ctx: PageContext): string {
  const lines: string[] = [];
  if (ctx.path !== undefined) lines.push(`path: ${ctx.path}`);
  if (ctx.surveyId !== undefined) lines.push(`surveyId: ${ctx.surveyId}`);
  if (ctx.sessionId !== undefined) lines.push(`sessionId: ${ctx.sessionId}`);
  if (ctx.recentSessionIds !== undefined && ctx.recentSessionIds.length > 0) {
    lines.push(`recentSessionIds: ${JSON.stringify(ctx.recentSessionIds)}`);
  }
  if (ctx.selectedSegmentIds !== undefined && ctx.selectedSegmentIds.length > 0) {
    lines.push(`selectedSegmentIds: ${JSON.stringify(ctx.selectedSegmentIds)}`);
  }
  return lines.join("\n");
}
