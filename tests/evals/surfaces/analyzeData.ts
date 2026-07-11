import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { SurveyAnalysisReportOutputSchema } from "@merism/contracts";
import { z } from "zod";

import type { SurfaceAdapter } from "./_types";

export interface AnalyzeDataSurfaceInput {
  readonly userMessage: string;
  readonly report: unknown;
}

export type AnalyzeDataSurfaceOutput =
  | { readonly kind: "answer"; readonly answer: string }
  | { readonly kind: "refusal"; readonly reason: string };

const SYSTEM_PROMPT = `你是 Merism 研究员助手 Morris 在 analyzeData 路径上的回答器。
你会收到一份已经存在的 survey 聚合分析报告,你的任务是基于这份报告回答研究员问题。

规则:
1. 只基于给定报告作答,不要编造新的调研或数据。
2. 若问题超出报告支持范围,返回 refusal。
3. 不提及团队、计费、seat、quota、pricing 等永久排除概念。`;

const OutputSchema = z.object({
  kind: z.enum(["answer", "refusal"]),
  answer: z.string().optional(),
  reason: z.string().optional(),
});

export const analyzeDataSurface: SurfaceAdapter<AnalyzeDataSurfaceInput, AnalyzeDataSurfaceOutput> = {
  name: "morris.tool.analyzeData",

  async invoke(input) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY not set — eval surface morris.tool.analyzeData requires a real provider key',
      );
    }

    const report = SurveyAnalysisReportOutputSchema.parse(input.report);
    const deepseek = createDeepSeek({ apiKey });

    const prompt = [
      `研究员问题: ${input.userMessage}`,
      `报告标题: ${report.surveyTitle}`,
      `已完成受访者: ${report.completedRespondents}`,
      `主题: ${report.themes.map((theme) => `${theme.label}(${theme.mentions}/${theme.pct}%)`).join("; ")}`,
      `洞察: ${report.insights.map((insight) => `${insight.title}: ${insight.text}`).join("; ")}`,
    ].join("\n\n");

    const { experimental_output } = await generateText({
      model: deepseek("deepseek-chat"),
      maxRetries: 1,
      experimental_output: Output.object({ schema: OutputSchema }),
      system: SYSTEM_PROMPT,
      prompt,
    });

    if (!experimental_output || experimental_output.kind === "refusal") {
      return {
        kind: "refusal",
        reason:
          typeof experimental_output?.reason === "string"
            ? experimental_output.reason
            : "model refused to answer from the report",
      };
    }

    return {
      kind: "answer",
      answer: experimental_output.answer ?? "",
    };
  },
};
