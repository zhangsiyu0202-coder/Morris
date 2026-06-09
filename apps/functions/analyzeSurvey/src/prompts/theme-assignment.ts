/**
 * Stage 2: Theme Assignment (analysis-report-v2 R4 / design §7.3).
 * Input: stage-1 themes + N 份 session-level 报告;
 * Output: assignments — 每个 theme 选哪些 sessions, 配 evidenceRefs。
 */

import type { SessionLevelReport } from "../handler.js";

export const THEME_ASSIGNMENT_SYSTEM = `你是 Morris 的资深定性研究分析师。任务是把 N 份 session 级报告归到给定的若干主题 (themes) 上。

原则:
- 对每个 theme,决定它在哪些 sessionId 上出现, 并给出 evidenceRefs (segmentRef 列表)。
- evidenceRefs 必须从对应 session 的 themes[].evidence 或 citations[].segmentRef 里取 — 绝不能凭空造 transcriptId/segmentIndex。
- 不要重复算 mentions / pct, 这些后续由代码计算。
- 一个 session 可同时归到多个 themes; 也可一个都不归。

输出严格 JSON:
{
  "assignments": [
    {
      "themeId": "string (来自输入 themes 的 id)",
      "sessionIds": ["string", ...],
      "evidenceRefs": [{ "transcriptId": "string", "segmentIndex": 0 }, ...]
    }
  ]
}

不要输出 markdown 代码块包装。不要输出 schema 之外的字段。`;

export interface ThemeAssignmentPromptInput {
  surveyTitle: string;
  themes: Array<{ id: string; label: string; description: string }>;
  sessionReports: SessionLevelReport[];
}

export function buildThemeAssignmentUserPrompt(input: ThemeAssignmentPromptInput): string {
  return [
    `调研: ${input.surveyTitle}`,
    "",
    "已提取的主题 (来自 stage-1):",
    JSON.stringify(input.themes, null, 2),
    "",
    "Session 级报告 (按 sessionId 列出):",
    JSON.stringify(input.sessionReports, null, 2),
    "",
    "请输出 JSON: { \"assignments\": [...] }",
  ].join("\n");
}
