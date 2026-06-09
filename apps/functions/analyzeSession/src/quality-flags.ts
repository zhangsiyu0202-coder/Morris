/**
 * qualityFlags 推导 (analysis-report-v2 R1 / design §5).
 *
 * 三步推导:
 *   1. deriveQualityFlagsRule  — 纯函数, 给 mechanical flags (silent / too-short / too-long)。
 *   2. deriveQualityFlagsLLM   — 异步, 给 semantic flags; silent/too-short 时跳过 (D10)。
 *   3. enforceMutex            — 按 P-ANL-06 互斥表剔除冲突,规则优先 (mechanical > LLM)。
 *
 * superRefine 在 InterviewSessionSchema 上做最后一道兜底校验。
 */

import type { SessionQualityFlag } from "@merism/contracts";

import {
  SILENT_RESPONDENT_MIN_CHARS,
  TOO_LONG_DURATION_MS,
  TOO_SHORT_RESPONDENT_MAX_CHARS,
} from "./constants.js";
import type { SurveyContext, TranscriptRecord } from "./handler.js";

interface RuleInput {
  transcript: TranscriptRecord;
  totalDurationMs: number;
}

interface LLMInput {
  transcript: TranscriptRecord;
  surveyContext: SurveyContext;
}

const MUTEX_PAIRS: ReadonlyArray<readonly [SessionQualityFlag, SessionQualityFlag]> = [
  ["silent", "fluent"],
  ["silent", "deep-engagement"],
  ["too-short", "deep-engagement"],
  ["fluent", "shallow"],
];

const MECHANICAL_FLAGS = new Set<SessionQualityFlag>(["silent", "too-short", "too-long"]);

/** 受访者 (非 interviewer) 文本长度合计。speaker 命名空间宽松, 不是 "interviewer/agent" 的视为受访者。 */
function respondentTextLength(transcript: TranscriptRecord): number {
  let chars = 0;
  for (const seg of transcript.segments) {
    const speaker = seg.speaker.toLowerCase();
    if (speaker === "interviewer" || speaker === "agent" || speaker === "ai") continue;
    chars += seg.text.length;
  }
  return chars;
}

export function deriveQualityFlagsRule(input: RuleInput): SessionQualityFlag[] {
  const flags: SessionQualityFlag[] = [];
  const respondentChars = respondentTextLength(input.transcript);

  if (respondentChars < SILENT_RESPONDENT_MIN_CHARS) {
    flags.push("silent");
  } else if (respondentChars <= TOO_SHORT_RESPONDENT_MAX_CHARS) {
    flags.push("too-short");
  }

  if (input.totalDurationMs > TOO_LONG_DURATION_MS) {
    flags.push("too-long");
  }

  return flags;
}

/** 是否需要进 LLM 阶段 (silent / too-short 时跳过, D10)。 */
export function shouldRunLLMStage(ruleFlags: ReadonlyArray<SessionQualityFlag>): boolean {
  return !ruleFlags.includes("silent") && !ruleFlags.includes("too-short");
}

export type DeriveQualityFlagsLLM = (
  input: LLMInput,
) => Promise<{ flags: SessionQualityFlag[] }>;

export async function deriveQualityFlagsLLM(
  input: LLMInput,
  fn: DeriveQualityFlagsLLM,
): Promise<SessionQualityFlag[]> {
  try {
    const { flags } = await fn(input);
    return flags;
  } catch {
    // LLM 阶段失败不应阻塞分析,回 [] 让规则层结果生效。
    return [];
  }
}

/**
 * P-ANL-06: mutex 强制。规则层 flag (mechanical) 优先于 LLM 层 (semantic):
 * 任意一对冲突中, 若 mechanical 在场则保留 mechanical, 删除 semantic; 两者都属
 * 同层级时按列表 (先 mechanical, 后 semantic) 顺序保留前者。
 */
export function enforceMutex(flags: ReadonlyArray<SessionQualityFlag>): SessionQualityFlag[] {
  const set = new Set<SessionQualityFlag>(flags);
  for (const [a, b] of MUTEX_PAIRS) {
    if (!set.has(a) || !set.has(b)) continue;
    const aIsMechanical = MECHANICAL_FLAGS.has(a);
    const bIsMechanical = MECHANICAL_FLAGS.has(b);
    if (aIsMechanical && !bIsMechanical) {
      set.delete(b);
    } else if (bIsMechanical && !aIsMechanical) {
      set.delete(a);
    } else {
      // 同层级 → 保留先出现的, 删后面的
      set.delete(b);
    }
  }
  return Array.from(set);
}

export interface DeriveQualityFlagsArgs {
  transcript: TranscriptRecord;
  surveyContext: SurveyContext;
  totalDurationMs: number;
  llm: DeriveQualityFlagsLLM;
}

export async function deriveQualityFlags(
  args: DeriveQualityFlagsArgs,
): Promise<SessionQualityFlag[]> {
  const ruleFlags = deriveQualityFlagsRule({
    transcript: args.transcript,
    totalDurationMs: args.totalDurationMs,
  });

  if (!shouldRunLLMStage(ruleFlags)) {
    return enforceMutex(ruleFlags);
  }

  const llmFlags = await deriveQualityFlagsLLM(
    { transcript: args.transcript, surveyContext: args.surveyContext },
    args.llm,
  );

  return enforceMutex([...ruleFlags, ...llmFlags]);
}
