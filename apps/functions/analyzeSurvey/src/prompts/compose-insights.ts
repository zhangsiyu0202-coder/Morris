/**
 * Stage 3: Compose Insights / Citations / Topics / Sentiment (analysis-report-v2 R4 / design §7.3).
 * Input: enrichedThemes (themes + themeContexts) + sessionReports + questionStats;
 * Output: insights / citations / topics / sentimentBreakdown / themeSentiments / questionSummaries。
 */

import type { SessionLevelReport } from "../handler.js";

export const COMPOSE_INSIGHTS_SYSTEM = `你是 Morris 的资深定性研究分析师。给你一组已经聚合好的主题 (themes + themeContexts), 一组 session 级报告与已聚合的题目统计 (questionStats), 你的任务是产出 survey 级报告里**剩下**的字段。

原则:
- citations.segmentRef 必须出现在 sessionReports 的 themes[].evidence 或 citations[].segmentRef 集合中 (不能凭空造)。
- citations.themeIds 必须指向给定 themes 中存在的 id。
- insights 给出整体级别的关键洞察, 每条带 confidence (0..1)。
- sentimentBreakdown 是 positive / neutral / negative 的样本计数, 合计 == 总 session 数。
- topics 是 2-5 条用一句话描述的研究焦点。
- themeSentiments 是 themeId -> "positive" | "neutral" | "negative" 的映射, 与 sentimentBreakdown 同源 (逻辑一致)。
- questionSummaries 是 questionId -> 简短叙述性 summary 的映射 (回填到 questionStats.summary)。
- 全程使用与 transcript 一致的语言。

输出严格 JSON:
{
  "insights": [{"id": "i1", "title": "...", "text": "...", "confidence": 0.8}, ...],
  "citations": [{"segmentRef": {"transcriptId":"...","segmentIndex":0}, "quote":"...", "themeIds":["t1"]}, ...],
  "topics": ["...", ...],
  "sentimentBreakdown": [{"sentiment":"positive","count":3}, ...],
  "themeSentiments": {"t1": "positive", "t2": "neutral"},
  "questionSummaries": {"q1": "...", "q2": "..."}
}

不要输出 markdown 代码块包装。不要输出 schema 之外的字段。不要重写 themes (它们已经定型)。`;

export interface ComposeInsightsPromptInput {
  surveyTitle: string;
  totalSessions: number;
  themes: Array<{ id: string; label: string; mentions: number; pct: number }>;
  themeContexts: Array<{
    id: string;
    label: string;
    description: string;
    evidenceRefs: Array<{ transcriptId: string; segmentIndex: number }>;
  }>;
  questionStats: Array<{ questionId: string; kind: string }>;
  sessionReports: SessionLevelReport[];
}

export function buildComposeInsightsUserPrompt(input: ComposeInsightsPromptInput): string {
  return [
    `调研: ${input.surveyTitle}`,
    `已完成 session 数: ${input.totalSessions}`,
    "",
    "Themes (已聚合, 不要改动):",
    JSON.stringify(input.themes, null, 2),
    "",
    "Theme contexts (附加描述与 evidenceRefs, 仅供本次 LLM 推理使用):",
    JSON.stringify(input.themeContexts, null, 2),
    "",
    "Question stats (kind 与 questionId, 用于 questionSummaries):",
    JSON.stringify(input.questionStats, null, 2),
    "",
    "Session 级报告:",
    JSON.stringify(input.sessionReports, null, 2),
    "",
    "请输出 JSON: { insights, citations, topics, sentimentBreakdown, themeSentiments, questionSummaries }",
  ].join("\n");
}
