/**
 * Stage 1.5: Theme Combination (analysis-report-v2 R6 / design §11 / D15).
 * Input: 多份 chunked extraction 产出的 raw themes;
 * Output: 合并去重后的统一 themes 列表 (与单次 extraction 输出 schema 等价)。
 *
 * 借鉴: posthog `ee/hogai/session_summaries/session_group/templates/patterns_combining/prompt.djt`
 * 同款 "feature area / root cause / 2+ indicators 重叠 → MERGE 否则 KEEP" 判定规则。
 */

import type { ExtractedThemes } from "../rollup.js";

export const THEME_COMBINATION_SYSTEM = `你是 Morris 的资深定性研究分析师。任务是把来自不同 session chunks 的多份 raw themes 列表合并、去重为一份统一的主题清单。

合并/保留判定规则 (向 hogai patterns_combining 借鉴):
- **MERGE** (合并为一条): 任一项满足
  1. 两条 theme 描述同一研究领域/用户旅程阶段 (feature area) 且 root cause 相同/相近;
  2. 两条 theme 在同一 feature area 内, 且 indicators 至少 2 项重叠 (措辞不同也算);
  3. 两条 theme indicators 至少 3 项重叠 且描述同一类用户行为 (困惑 / 放弃 / 出错)。
- **KEEP SEPARATE**: 否则 (例如 "登录页面 perf 问题" 与 "登录身份验证错误" 在不同维度, 不要合并)。

合并后:
- 给 theme 一个**新的稳定 id** (短, 例如 'c1', 'c2', ...). 不要复用 chunk 内的 id 以避免冲突。
- 描述要 cover 被合并的所有 raw theme 的语义, 不要丢失独立信号。
- 保持原始 indicators 与 description 的语言 (与原 session reports 一致)。

输出严格 JSON, 与单次 extraction 输出形态一致:
{
  "themes": [
    {
      "id": "string (短稳定, 例如 'c1')",
      "label": "string (1 句话主题名)",
      "description": "string (2-3 句详述)",
      "severity": "low | medium | high (可选)",
      "indicators": ["可选: 几个触发词或现象的列表"]
    }
  ]
}

不要输出 markdown 代码块包装。不要输出 schema 之外的字段。`;

export interface ThemeCombinationPromptInput {
  surveyTitle: string;
  totalSessions: number;
  rawThemesList: ExtractedThemes[];
}

export function buildThemeCombinationUserPrompt(
  input: ThemeCombinationPromptInput,
): string {
  const chunks = input.rawThemesList.map((rt, i) => {
    const block = JSON.stringify(rt, null, 2);
    return `Chunk #${i + 1}:\n${block}`;
  });
  return [
    `调研: ${input.surveyTitle}`,
    `已完成 session 数: ${input.totalSessions}`,
    `已抽取 chunk 数: ${input.rawThemesList.length}`,
    "",
    "以下是各 chunk 抽取出的 raw themes 列表, 请按规则合并/保留:",
    "",
    chunks.join("\n\n---\n\n"),
    "",
    '请输出 JSON: { "themes": [...] } — 合并后的最终 themes (字段集与单次 extraction 等价)。',
  ].join("\n");
}
