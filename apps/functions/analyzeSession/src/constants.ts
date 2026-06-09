/**
 * analyzeSession v2 常量 (analysis-report-v2 spec).
 *
 * 与 hogai `ee/hogai/session_summaries/constants.py` 中
 * HALLUCINATED_EVENTS_MIN_RATIO 同源 (我们设 0.15 与之对齐, 上线后据线上数据调优)。
 */

export const HALLUCINATION_RATIO_THRESHOLD = 0.15;

export const SESSION_QUALITY_FLAG_LLM_TEMPERATURE = 0.2;

/** 受访者发言总字符数低于此值 → silent (规则推导, 见 design §5.1)。 */
export const SILENT_RESPONDENT_MIN_CHARS = 50;

/** 受访者发言总字符数 ≤ 此值 → too-short。 */
export const TOO_SHORT_RESPONDENT_MAX_CHARS = 200;

/** 通话总时长 > 此值 → too-long (默认 60 分钟)。 */
export const TOO_LONG_DURATION_MS = 60 * 60_000;
