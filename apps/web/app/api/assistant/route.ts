import { streamText, convertToModelMessages, tool, stepCountIs, type UIMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { STUDIES, searchSnippets, analyzeStudy } from "@/lib/agent-data";

// DeepSeek 官方直连。key 存于 AI_GATEWAY_API_KEY(实为 DeepSeek 官方 key),回退到 DEEPSEEK_API_KEY。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

// Node runtime required for AI SDK (never edge).
export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `你是 Morris 的 AI 研究助手,帮助用户研究员完成用户调研工作。
你可以创建调研草稿、检索访谈数据、分析结果。
回答用简体中文,语气专业、克制、有洞察。
当用户想发起新调研时,调用 createStudyDraft。
当用户想了解受访者说了什么时,调用 searchInterviewData。
当用户想要统计或分析结论时,调用 analyzeData。
调用工具后,用一两句话解读结果,不要复述全部字段。`;

const tools = {
  createStudyDraft: tool({
    description: "根据研究目标创建一份调研草稿,产出标题、研究目标和建议问题列表。",
    inputSchema: z.object({
      goal: z.string().describe("研究目标的自然语言描述"),
      audience: z.string().nullable().describe("目标受访人群,可为空"),
      questionCount: z.number().min(3).max(10).describe("建议的问题数量"),
    }),
    execute: async ({ goal, audience, questionCount }) => {
      const base = [
        "当你需要解决这个问题时,通常会怎么做?",
        "请回想最近一次相关的经历,具体发生了什么?",
        "在这个过程中,最让你困扰的是什么?",
        "你尝试过哪些替代方案?效果如何?",
        "如果有一个理想的解决方案,它应该是什么样的?",
        "你愿意为此付出多少时间或成本?",
        "还有什么我们没问到、但你觉得重要的吗?",
      ];
      return {
        title: `${goal.slice(0, 20)} — 用户调研`,
        goal,
        audience: audience ?? "未指定",
        questions: base.slice(0, questionCount).map((q, i) => ({ order: i + 1, prompt: q })),
      };
    },
  }),
  searchInterviewData: tool({
    description: "在已有访谈记录中检索与关键词相关的受访者回答片段。",
    inputSchema: z.object({
      query: z.string().describe("检索关键词"),
      studyId: z.string().nullable().describe("限定某个调研的 id,可为空"),
    }),
    execute: async ({ query, studyId }) => {
      const results = searchSnippets(query, studyId ?? undefined);
      return { count: results.length, snippets: results };
    },
  }),
  analyzeData: tool({
    description: "对某个调研的结果做聚合统计与主题分析,返回关键指标与高频主题。",
    inputSchema: z.object({
      studyId: z.string().nullable().describe("要分析的调研 id,可为空则取默认调研"),
    }),
    execute: async ({ studyId }) => analyzeStudy(studyId ?? undefined),
  }),
  listStudies: tool({
    description: "列出当前账户下的所有调研及其状态与样本量。",
    inputSchema: z.object({}),
    execute: async () => ({ studies: STUDIES }),
  }),
};

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: deepseek("deepseek-chat"),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
