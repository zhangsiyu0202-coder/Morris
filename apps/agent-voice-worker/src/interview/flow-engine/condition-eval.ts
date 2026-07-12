/**
 * Condition-evaluation prompt builder for ConditionStep branching.
 *
 * Port of `apps/agent/agent/flow_engine/condition_eval.py` per ADR-0013 +
 * the flow-engine-ts-reimpl sub-spec. Wording is preserved byte-for-byte
 * from the Python source — the LLM is sensitive to the exact framing and
 * any change is a behaviour change, not a cleanup.
 *
 * Structurally parallel to `probe.ts`: pure prompt in the flow_engine layer,
 * LLM effect in the LiveKit host, YES/NO parsing shared via
 * `parseYesNo({ defaultBias: false })` for condition eval.
 */

import type { AnswerRecord } from "./types.js";

/**
 * Compose the YES/NO prompt for a natural-language branching condition.
 *
 * Contract:
 *   - Chinese phrasing (interview language + LLM cascade already
 *     Chinese-primed).
 *   - Explicit "YES"/"NO"-only instruction with no other-token allowance;
 *     `parseYesNo` is tolerant to drift (`Yes.`, `是的`, etc.) but the
 *     prompt still asks for exact tokens to minimize drift in the first
 *     place.
 *   - Condition is quoted verbatim so the LLM can distinguish researcher-
 *     authored instructions from surrounding scaffolding — mirrors
 *     `buildJudgePrompt` structure.
 *   - Source question content is included so the LLM has the context of
 *     WHAT the user was answering, not just the raw transcript.
 *
 * NOTE: `sourceAnswer.selectedOptionIds` is NOT included in the prompt.
 * Adding it would leak an internal id detail (opt-1, opt-2) that the LLM
 * would treat as noise or, worse, cite as reasoning. Option semantics are
 * already reflected in `respondentAnswer` (either the raw transcript for
 * voice, or the option label for UI clicks, both readable strings).
 */
export function buildConditionPrompt(
  condition: string,
  sourceAnswer: AnswerRecord,
): string {
  return (
    "你在做严格的布尔判断,不是猜测题。\n" +
    "只有当用户回答里出现了足够直接、明确的证据,能支持这个条件时,才能输出 YES。\n" +
    "如果回答是模糊的、信息不足的、只是在表达迷茫/找方向/状态不好,或者需要依赖常识猜测,一律输出 NO。\n" +
    "不要脑补,不要联想,不要按概率判断。\n\n" +
    "研究员为分支设定的条件:\n" +
    `${condition}\n\n` +
    "主持人刚问的问题:\n" +
    `${sourceAnswer.questionContent}\n\n` +
    "用户对该问题的回答:\n" +
    `${sourceAnswer.respondentAnswer}\n\n` +
    "请判断用户的回答是否满足研究员设定的条件?\n" +
    "如果满足,输出 \"YES\";如果不满足,输出 \"NO\"。\n" +
    "只输出 YES 或 NO,不要任何其他文字。"
  );
}
