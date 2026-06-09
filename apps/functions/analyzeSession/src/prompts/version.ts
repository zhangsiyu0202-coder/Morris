/**
 * analyzeSession prompt 版本号 (analysis-report-v2 D7 决策).
 *
 * 字符串硬编码在源代码中, prompt 改变 → 必须 bump (v2.1 / v2.2 / v3.0 ...)。
 * 写入 AnalysisReport.generationMeta.promptVersion, 让后续 sweep / eval / 回放
 * 能区分新旧报告。
 */
export const PROMPT_VERSION = "session.v2.0";
