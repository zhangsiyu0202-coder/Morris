import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  insightReportSchema,
  buildStudyContext,
  isValidStudyId,
} from "@/lib/insights";

export const maxDuration = 60;

// 与 Morris AI / Insights 一致:直连 DeepSeek 官方,不引入其它供应商。
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
});

const REPORT_INSTRUCTIONS = `你是 Morris 的深度研究分析师。用户已就某项调研提出了一个聚焦问题,并得到了初步洞察。
现在请你结合该调研的会话内容,围绕「这一个问题」做一份深入的论证型分析报告。

这份报告与「数据汇总报告」不同:它不是罗列整体统计,而是要围绕用户的问题层层拆解 ——
给出明确立场(directAnswer)、按维度深入分析(themes)、揭示受访者之间的观点分歧(divergences)、
并给出分优先级的行动建议(actions)。每个维度都要尽量引用受访者原话作为论据。

要求:
- 只依据提供的「调研上下文」作答,不要编造数据或原话。
- 对结论给出诚实的置信度(confidence):样本充足且观点一致为 high,有分歧或样本有限为 medium/low。
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

  // 2) 构建 grounding 上下文 + 生成深度分析报告
  try {
    const context = buildStudyContext(studyId);

    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 2,
      experimental_output: Output.object({ schema: insightReportSchema }),
      system: REPORT_INSTRUCTIONS,
      prompt: `调研上下文:\n${context}\n\n用户的问题:${question.trim()}\n\n请围绕这一个问题,结合会话内容生成深度分析报告。`,
    });

    return Response.json({ report: experimental_output }, { status: 200 });
  } catch (err) {
    console.error("[v0] insight report generation failed:", err);
    return Response.json(
      { error: "深度分析生成失败,请稍后重试。" },
      { status: 500 },
    );
  }
}
