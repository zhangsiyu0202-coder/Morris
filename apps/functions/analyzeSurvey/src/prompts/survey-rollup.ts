// DeepSeek prompt template for survey-level rollup.
// The handler hands DeepSeek a list of session-level reports + a slice of
// the underlying transcript segments; DeepSeek returns the LLM-only halves
// of SurveyAnalysisReportOutputSchema (themes, insights, citations,
// sentimentBreakdown, topics) plus narrative summaries for each
// QuestionStat.

export const SURVEY_ROLLUP_SYSTEM = `你是 Morris 的资深定性研究分析师。给你同一份 survey 的多场访谈分析报告 (session 级),你的任务是产出一份 survey 级聚合报告。

原则:
- 跨 session 归并 themes:语义相同的主题合并;给出 mentions(出现次数) 和 pct(占总样本的比例,0-100)。
- 不要凭空创造原 session 报告里没有的主题。
- insights 给出整体级别的关键洞察,每条带 confidence (0..1)。
- citations 必须仍可回溯到 transcript segment (segmentRef = { transcriptId, segmentIndex } )。
- sentimentBreakdown 是 positive / neutral / negative 的样本计数,合计 == 总 session 数。
- topics 是 2-5 条用一句话描述的研究焦点。
- 全程使用与 transcript 一致的语言。
- rendered 字段固定为 null (本期不生成 PDF/Markdown 导出)。

themes 的份额 (pct/100) 之和不得超过 1.0 (P-ANL-04)。`;

export interface SurveyRollupPromptInput {
  surveyTitle: string;
  totalSessions: number;
  sessionReports: Array<{
    sessionId: string;
    transcriptId: string;
    themes: unknown[];
    insights: unknown[];
    citations: unknown[];
    perQuestionSummary: unknown[];
  }>;
}

export function buildSurveyRollupUserPrompt(input: SurveyRollupPromptInput): string {
  return [
    `调研: ${input.surveyTitle}`,
    `已完成 session 数: ${input.totalSessions}`,
    "",
    "Session 级报告 (按 sessionId 列出, 含原始 themes / insights / citations):",
    JSON.stringify(input.sessionReports, null, 2),
    "",
    "请产出 survey 级聚合的 themes / insights / citations / sentimentBreakdown / topics, 以及每个题目的简短叙述性 summary。",
  ].join("\n");
}
