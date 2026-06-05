import { tool } from "ai";
import { z } from "zod";
import { STUDIES, searchSnippets, analyzeStudy } from "@/lib/agent-data";

/**
 * Assistant 工具层(Agent 能力)。
 *
 * 设计要点:
 * - 工具名与「成功」输出结构与前端 `tool-results.tsx` 严格一致,绝不更改契约。
 * - 每个 execute 都有错误兜底:任何内部异常都被捕获并转成结构化的
 *   `{ error: true, message }`,前端据此渲染失败态,而不是让整条流崩溃。
 * - 对「数据获取」这类未来会接真实后端、可能瞬时失败的操作用 `withRetry`
 *   包装(指数退避重试),当前 mock 数据源同样走这条路径,接真实源时即生效。
 */

/** 工具执行失败时的统一结构(前端 tool-results 识别 error 字段渲染失败态)。 */
export type ToolError = { error: true; message: string };

/** 指数退避重试。用于可能瞬时失败的数据获取(未来接真实数据源时生效)。 */
async function withRetry<T>(
  fn: () => Promise<T> | T,
  { retries = 2, baseDelayMs = 150, label = "operation" }: { retries?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
      }
    }
  }
  throw new Error(`${label} 在 ${retries + 1} 次尝试后仍失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** 把任意异常转成给用户看的简短中文错误,绝不抛到流外。 */
function toToolError(label: string, err: unknown): ToolError {
  const detail = err instanceof Error ? err.message : String(err);
  return { error: true, message: `${label}失败:${detail}` };
}

const STUDY_QUESTION_BANK = [
  "当你需要解决这个问题时,通常会怎么做?",
  "请回想最近一次相关的经历,具体发生了什么?",
  "在这个过程中,最让你困扰的是什么?",
  "你尝试过哪些替代方案?效果如何?",
  "如果有一个理想的解决方案,它应该是什么样的?",
  "你愿意为此付出多少时间或成本?",
  "还有什么我们没问到、但你觉得重要的吗?",
  "你是如何评估一个方案是否值得继续使用的?",
  "在做决定时,谁或什么会影响你?",
  "回到最开始,你希望当时有人告诉你什么?",
];

export const assistantTools = {
  createStudyDraft: tool({
    description: "根据研究目标创建一份调研草稿,产出标题、研究目标和建议问题列表。当用户想发起新调研、设计问卷或访谈提纲时调用。",
    inputSchema: z.object({
      goal: z.string().min(1).describe("研究目标的自然语言描述"),
      audience: z.string().nullable().describe("目标受访人群,可为空"),
      questionCount: z.number().int().min(3).max(10).describe("建议的问题数量(3-10)"),
    }),
    execute: async ({ goal, audience, questionCount }) => {
      try {
        const count = Math.min(Math.max(Math.round(questionCount), 3), 10);
        const questions = STUDY_QUESTION_BANK.slice(0, count).map((q, i) => ({ order: i + 1, prompt: q }));
        return {
          title: `${goal.slice(0, 20)} — 用户调研`,
          goal,
          audience: audience?.trim() ? audience : "未指定",
          questions,
        };
      } catch (err) {
        return toToolError("创建调研草稿", err);
      }
    },
  }),

  searchInterviewData: tool({
    description: "在已有访谈记录中检索与关键词相关的受访者回答片段。当用户想了解受访者具体说了什么、查找原话或某类反馈时调用。",
    inputSchema: z.object({
      query: z.string().describe("检索关键词,可为空字符串以返回全部"),
      studyId: z.string().nullable().describe("限定某个调研的 id,可为空表示全部调研"),
    }),
    execute: async ({ query, studyId }) => {
      try {
        const results = await withRetry(() => searchSnippets(query ?? "", studyId ?? undefined), { label: "检索访谈数据" });
        return { count: results.length, snippets: results };
      } catch (err) {
        return toToolError("检索访谈数据", err);
      }
    },
  }),

  analyzeData: tool({
    description: "对某个调研的结果做聚合统计与主题分析,返回关键指标与高频主题。当用户想要统计结论、整体洞察或趋势时调用。",
    inputSchema: z.object({
      studyId: z.string().nullable().describe("要分析的调研 id,可为空则取默认调研"),
    }),
    execute: async ({ studyId }) => {
      try {
        return await withRetry(() => analyzeStudy(studyId ?? undefined), { label: "分析调研数据" });
      } catch (err) {
        return toToolError("分析调研数据", err);
      }
    },
  }),

  listStudies: tool({
    description: "列出当前账户下的所有调研及其状态与样本量。当用户问有哪些调研、或需要先了解上下文再决定调用哪个工具时调用。",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const studies = await withRetry(() => STUDIES, { label: "读取调研列表" });
        return { studies };
      } catch (err) {
        return toToolError("读取调研列表", err);
      }
    },
  }),
};

export type AssistantTools = typeof assistantTools;
