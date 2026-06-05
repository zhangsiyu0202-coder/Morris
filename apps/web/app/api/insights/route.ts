import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  insightSchema,
  buildStudyContext,
  isValidStudyId,
} from "@/lib/insights";

export const maxDuration = 60;

// 与 Morris AI 一致:直连 DeepSeek 官方,不引入其它供应商。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const INSIGHT_INSTRUCTIONS = `你是 Morris 的研究洞察引擎。用户已完成一项调研,现在针对该调研提出一个聚焦问题。
你的任务是:严格基于提供的「调研上下文」(统计指标、主题分布、受访者原话),回答用户的问题并生成结构化洞察。

要求:
- 只依据给定数据作答,不要编造数据或原话。若数据不足以回答,在 summary 中坦诚说明。
- keyPoints 的每条 evidence 尽量引用真实的受访者原话或具体数字。
- 语言简洁、专业,使用中文。`;

export async function POST(req: Request) {
  // 1) 解析与参数校验
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  const { studyId, question } = (body ?? {}) as {
    studyId?: unknown;
    question?: unknown;
  };

  if (typeof studyId !== "string" || !studyId.trim()) {
    return Response.json({ error: "缺少 studyId 参数。" }, { status: 400 });
  }
  if (!isValidStudyId(studyId)) {
    return Response.json({ error: "指定的调研不存在。" }, { status: 404 });
  }
  if (typeof question !== "string" || question.trim().length < 2) {
    return Response.json(
      { error: "请输入一个有效的问题(至少 2 个字符)。" },
      { status: 400 },
    );
  }

  // 2) 构建 grounding 上下文 + 生成结构化洞察
  try {
    const context = buildStudyContext(studyId);

    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 2,
      experimental_output: Output.object({ schema: insightSchema }),
      system: INSIGHT_INSTRUCTIONS,
      prompt: `调研上下文:\n${context}\n\n用户的问题:${question.trim()}\n\n请基于上述上下文生成结构化洞察。`,
    });

    return Response.json({ insight: experimental_output }, { status: 200 });
  } catch (err) {
    console.error("[v0] insights generation failed:", err);
    return Response.json(
      { error: "洞察生成失败,请稍后重试。" },
      { status: 500 },
    );
  }
}
