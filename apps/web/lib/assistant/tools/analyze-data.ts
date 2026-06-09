import { tool } from "ai";
import { z } from "zod";

import {
  getLatestAnalysisReport,
  parseSurveyReportBody,
} from "@/lib/queries";

import {
  NOT_SIGNED_IN,
  toToolError,
  toolResult,
  type ToolErrorArtifact,
  type ToolResultEnvelope,
} from "../envelope";
import type { AssistantToolContext } from "../tool-types";

interface AnalyzeArtifact {
  studyTitle: string;
  completedRespondents: number;
  topThemes: Array<{
    label: string;
    mentions: number;
    pct: number;
    sentiment: string;
  }>;
  topInsights: Array<{
    title: string;
    text: string;
    confidence: number;
  }>;
}

/**
 * `analyzeData` 工具:返回该调研最新 survey 级聚合报告。
 *
 * `contextPromptTemplate` (R2): 把当前页面、主调研、最近会话喂给模型,
 * 让它能判断"用户问的是不是当前页这个调研、报告值不值得现在调"。
 */
export function buildAnalyzeDataTool(ctx: AssistantToolContext) {
  const { ownerUserId } = ctx;
  return {
    contextPromptTemplate:
      "当前页面: {path}. 主调研: {surveyId}. 最近会话: {recentSessionIds}.",
    spec: tool({
      description:
        "返回指定调研的最新 survey 级聚合分析报告(由 analyzeSurvey Function 生成并落 Appwrite)。当用户想要整体洞察、趋势或主题分布时调用。",
      inputSchema: z.object({
        studyId: z.string().describe("要分析的调研 id (必填)"),
      }),
      execute: async ({
        studyId,
      }): Promise<ToolResultEnvelope<AnalyzeArtifact | ToolErrorArtifact>> => {
        if (!ownerUserId) return NOT_SIGNED_IN;
        try {
          const stored = await getLatestAnalysisReport(ownerUserId, {
            surveyId: studyId,
            scope: "survey",
          });
          if (!stored) {
            const message =
              "尚无 survey 级聚合报告。可在 /reports/" +
              studyId +
              " 中生成,或等待新一场访谈完成后系统自动产出。";
            return { content: "尚无 survey 级聚合报告。", artifact: { error: true, message } };
          }
          const body = parseSurveyReportBody(stored);
          if (!body) {
            return toToolError("解析报告", new Error("schema_mismatch"));
          }
          const artifact: AnalyzeArtifact = {
            studyTitle: body.surveyTitle,
            completedRespondents: body.completedRespondents,
            topThemes: body.themes.slice(0, 5).map((t) => ({
              label: t.label,
              mentions: t.mentions,
              pct: t.pct,
              sentiment: t.sentiment,
            })),
            topInsights: body.insights.slice(0, 4).map((i) => ({
              title: i.title,
              text: i.text,
              confidence: i.confidence,
            })),
          };
          return toolResult(
            `已读取「${artifact.studyTitle}」的最新聚合报告,完成受访者 ${artifact.completedRespondents} 人。`,
            artifact,
          );
        } catch (err) {
          return toToolError("分析调研数据", err);
        }
      },
    }),
  };
}
