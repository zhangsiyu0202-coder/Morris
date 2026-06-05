import { z } from "zod";
import { STUDIES, searchSnippets, analyzeStudy } from "./agent-data";

/**
 * Insights 功能的数据/契约层。
 *
 * 与 Morris AI(多轮对话 agent)不同,Insights 是「研究完成后」的一次性洞察生成:
 * 用户选定某个调研 + 输入一个聚焦问题 → 基于该调研的真实访谈数据,
 * 直连 DeepSeek 生成结构化洞察(标题 / 概述 / 关键发现+依据 / 建议)。
 *
 * 数据来源沿用 agent-data(mock 后端),保证返回结构是生产形态。
 */

/**
 * 深度分析报告契约 —— 用于洞察详情页。
 *
 * 与「卡片洞察(insightSchema)」是快速结论不同,这里是针对同一个自定义问题、
 * 结合该 study 会话内容做的「重新深入分析」:它要呈现立场分歧、内在张力、
 * 分群证据与分优先级的行动建议。也与 Report(信息汇总)刻意区分 —— 这是
 * 围绕「一个问题」的论证型报告,而非整体数据汇总。
 */
export const insightReportSchema = z.object({
  headline: z.string().describe("一句话核心结论,作为这份分析的标题,精炼有力"),
  directAnswer: z.string().describe("用 2-3 句直接、明确地回答这个问题,给出立场"),
  confidence: z.enum(["high", "medium", "low"]).describe("基于现有数据对该结论的置信度"),
  confidenceReason: z.string().describe("一句话说明置信度判断依据,如样本量/一致性"),
  themes: z
    .array(
      z.object({
        title: z.string().describe("一个分析维度/角度的标题"),
        analysis: z.string().describe("围绕该维度对会话内容的深入分析,3-4 句"),
        quotes: z.array(z.string()).describe("1-3 条支撑该维度的受访者原话"),
      }),
    )
    .describe("3-4 个分析维度,逐层拆解这个问题"),
  divergences: z
    .array(
      z.object({
        group: z.string().describe("持该观点的人群/立场描述"),
        stance: z.string().describe("该群体的核心主张"),
      }),
    )
    .describe("2-3 组受访者之间的观点分歧或对立立场"),
  actions: z
    .array(
      z.object({
        priority: z.enum(["P0", "P1", "P2"]).describe("优先级"),
        action: z.string().describe("具体可执行的行动建议"),
        rationale: z.string().describe("为什么这么做,关联到上面的分析"),
      }),
    )
    .describe("3-4 条分优先级的行动建议"),
});

export type InsightReport = z.infer<typeof insightReportSchema>;

// 供前端下拉选择的调研列表(只暴露需要的字段)。
export function listStudyOptions() {
  return STUDIES.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    responses: s.responses,
  }));
}

export function isValidStudyId(studyId: string): boolean {
  return STUDIES.some((s) => s.id === studyId);
}

/**
 * 为给定调研构建洞察生成所需的上下文文本:聚合统计 + 主题分布 + 真实访谈原话。
 * 该上下文会作为 grounding 注入 LLM,确保洞察基于真实数据而非臆测。
 */
export function buildStudyContext(studyId: string): string {
  const analysis = analyzeStudy(studyId);
  const snippets = searchSnippets("", studyId);

  const themeLines = analysis.themes
    .map((t) => `- ${t.label}:占比 ${Math.round(t.share * 100)}%`)
    .join("\n");

  const sliceLines = analysis.slices
    .map((s) => `- ${s.metric}:${s.value}(${s.detail})`)
    .join("\n");

  const quoteLines =
    snippets.length > 0
      ? snippets
          .map(
            (s) =>
              `- [${s.respondent} · ${s.sentiment}] 关于「${s.questionTitle}」:"${s.quote}"`,
          )
          .join("\n")
      : "(该调研暂无可用的访谈原话)";

  return [
    `调研标题:${analysis.studyTitle}`,
    `整体结论:${analysis.headline}`,
    "",
    "关键指标:",
    sliceLines,
    "",
    "高频主题分布:",
    themeLines,
    "",
    "受访者原话(节选):",
    quoteLines,
  ].join("\n");
}
