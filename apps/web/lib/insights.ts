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

// 生成结果的结构化契约 —— 前端按此渲染洞察卡。
export const insightSchema = z.object({
  headline: z.string().describe("一句话核心洞察,直接回答用户的问题"),
  summary: z.string().describe("2-3 句话的概述,综合该调研数据"),
  keyPoints: z
    .array(
      z.object({
        point: z.string().describe("一条关键发现"),
        evidence: z.string().describe("支撑该发现的依据,尽量引用受访者原话或具体数据"),
      }),
    )
    .describe("3-5 条关键发现,每条都要有数据或原话支撑"),
  recommendation: z.string().describe("基于以上发现,给出可执行的下一步建议"),
});

export type GeneratedInsight = z.infer<typeof insightSchema>;

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
