/**
 * analyzeSurvey v2 常量 (analysis-report-v2 spec).
 * 与 analyzeSession constants 同形,但物理隔离便于独立调优。
 */
export const HALLUCINATION_RATIO_THRESHOLD = 0.15;
export const ROLLUP_LLM_TEMPERATURE = 0.3;

// Wave F (D15): chunk + combination 三段式阈值与块大小。
// 阈值与 hogai PATTERNS_ASSIGNMENT_CHUNK_SIZE = 10 对齐:
// - sessionReports.length > EXTRACTION_CHUNK_THRESHOLD 时启用 chunked extract + combine
// - assignment 阶段一律走 chunked + 代码 merge (不引入 LLM 合并)
export const EXTRACTION_CHUNK_THRESHOLD = 10;
export const EXTRACTION_CHUNK_SIZE = 10;
export const ASSIGNMENT_CHUNK_SIZE = 10;
