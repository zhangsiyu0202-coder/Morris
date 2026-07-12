/**
 * `buildConditionPrompt` shape + `parseYesNo` symmetric-bias tests.
 *
 * Ports Python `test_flow_engine_condition_eval.py` + `test_flow_engine_probe.py`
 * parseYesNo cases. Locks HANDOFF.md § 关键设计 decision 4 (LLM only decides
 * YES/NO, code owns the loop) at the prompt + parser layer.
 *
 * P-FLOW-14: parseYesNo defaultBias is symmetric-opposite between probe
 *            (true = safer stop) and condition (false = safer no-divert).
 */

import { describe, expect, it } from "vitest";
import {
  buildConditionPrompt,
  parseYesNo,
} from "../../../apps/agent-voice-worker/src/interview/flow-engine/index";
import type { AnswerRecord } from "../../../apps/agent-voice-worker/src/interview/flow-engine/index";

function ans(question: string, respondent: string, opts: string[] = []): AnswerRecord {
  return {
    questionContent: question,
    respondentAnswer: respondent,
    selectedOptionIds: opts,
  };
}

// ---------------------------------------------------------------------------
// buildConditionPrompt shape
// ---------------------------------------------------------------------------

describe("buildConditionPrompt — shape invariants (HANDOFF appendix A)", () => {
  it("includes the researcher's condition verbatim", () => {
    const p = buildConditionPrompt(
      "用户表示自己是全职学生",
      ans("你现在的身份?", "我是学生"),
    );
    expect(p).toContain("用户表示自己是全职学生");
  });

  it("includes the source question content", () => {
    const p = buildConditionPrompt("cond", ans("你现在的身份?", "我是学生"));
    expect(p).toContain("你现在的身份?");
  });

  it("includes the respondent answer", () => {
    const p = buildConditionPrompt("cond", ans("Q", "我是硕士在读"));
    expect(p).toContain("我是硕士在读");
  });

  it("instructs YES/NO-only output", () => {
    const p = buildConditionPrompt("cond", ans("Q", "A"));
    expect(p).toContain("YES");
    expect(p).toContain("NO");
    expect(p).toContain("只输出 YES 或 NO");
  });

  it("does NOT include selected option ids (avoid opt-1 leaking as noise)", () => {
    const p = buildConditionPrompt("cond", ans("Q", "A", ["opt-1", "opt-2"]));
    expect(p).not.toContain("opt-1");
    expect(p).not.toContain("opt-2");
    expect(p).not.toContain("selectedOptionIds");
  });

  it("forbids inference on weak evidence (locks 严格布尔判断 wording)", () => {
    const p = buildConditionPrompt("cond", ans("Q", "A"));
    expect(p).toContain("严格的布尔判断");
    expect(p).toContain("不要脑补");
  });
});

// ---------------------------------------------------------------------------
// parseYesNo — symmetric-bias table
// ---------------------------------------------------------------------------

describe("parseYesNo — symmetric-bias between probe and condition", () => {
  it("garbage → defaultBias=false for condition eval (do not divert)", () => {
    expect(parseYesNo("???", { defaultBias: false })).toBe(false);
    expect(parseYesNo("完全看不懂", { defaultBias: false })).toBe(false);
  });

  it("garbage → defaultBias=true for probe judge (safer stop)", () => {
    // Empty/random string that has no yes/no signal.
    expect(parseYesNo("???", { defaultBias: true })).toBe(true);
  });

  it("explicit YES wins over any defaultBias", () => {
    expect(parseYesNo("YES", { defaultBias: false })).toBe(true);
    expect(parseYesNo("YES.", { defaultBias: false })).toBe(true);
    expect(parseYesNo("Yes, the goal is met", { defaultBias: false })).toBe(true);
  });

  it("explicit NO wins over any defaultBias", () => {
    expect(parseYesNo("NO", { defaultBias: true })).toBe(false);
    expect(parseYesNo("No.", { defaultBias: true })).toBe(false);
    expect(parseYesNo("no not yet", { defaultBias: true })).toBe(false);
  });

  it("Chinese 是/满足/够/达 → true even under defaultBias=false", () => {
    expect(parseYesNo("是的,满足", { defaultBias: false })).toBe(true);
    expect(parseYesNo("已经足够了", { defaultBias: false })).toBe(true);
    expect(parseYesNo("已达目标", { defaultBias: false })).toBe(true);
  });

  it("Chinese 不/没/否 → false even under defaultBias=true", () => {
    expect(parseYesNo("不", { defaultBias: true })).toBe(false);
    expect(parseYesNo("没达到", { defaultBias: true })).toBe(false);
    expect(parseYesNo("否", { defaultBias: true })).toBe(false);
  });

  it("mixed-case + punctuation still parses", () => {
    expect(parseYesNo(" yEs ", { defaultBias: false })).toBe(true);
    expect(parseYesNo("no.\n", { defaultBias: true })).toBe(false);
  });
});
