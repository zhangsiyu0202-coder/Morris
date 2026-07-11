/**
 * Stage 1: Theme Extraction (analysis-report-v2 R4 / design §7.3).
 * Input: 多份 session-level 报告; Output: themes 列表 (不带 session 归属)。
 */

import type { SessionLevelReport } from "../handler.js";

export const THEME_EXTRACTION_SYSTEM = `你是 Morris 的资深定性研究分析师。任务是从多份 session 级访谈分析报告中,提取跨 session 的共性主题 (themes)。

原则:
- 跨 session 归并语义相同的主题; 不要凭空创造原 session 报告里没有的主题。
- 每个 theme 都必须能在至少一个 session 中找到对应描述。
- **只输出 themes 列表, 不带 session 归属、mentions、pct 等信息** — 这些后续阶段会算。
- 全程使用与原 session reports 一致的语言。

输出严格 JSON:
{
  "themes": [
    {
      "id": "string (短而稳定, 例如 't1', 't2')",
      "label": "string (1 句话主题名)",
      "description": "string (2-3 句详述)",
      "severity": "low | medium | high (可选)",
      "indicators": ["可选: 几个触发词或现象的列表"]
    }
  ]
}

不要输出 markdown 代码块包装。不要输出 schema 之外的字段。`;

export interface ThemeExtractionPromptInput {
  surveyTitle: string;
  totalSessions: number;
  sessionReports: SessionLevelReport[];
}

export function buildThemeExtractionUserPrompt(input: ThemeExtractionPromptInput): string {
  return [
    `调研: ${input.surveyTitle}`,
    `已完成 session 数: ${input.totalSessions}`,
    "",
    "Session 级报告 (按 sessionId 列出, 含 themes / insights / citations / perQuestionSummary):",
    JSON.stringify(input.sessionReports, null, 2),
    "",
    "请输出 JSON: { \"themes\": [...] } — 不带 session 归属, 不算 mentions/pct。",
  ].join("\n");
}
