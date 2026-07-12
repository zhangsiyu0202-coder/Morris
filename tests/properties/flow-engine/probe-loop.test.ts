/**
 * Probe loop invariants. Ports the essential tests from Python
 * `apps/agent/tests/test_flow_engine_probe.py` covering the "code owns the
 * loop, LLM only decides YES/NO or generates the next probe question"
 * decision authority split (HANDOFF.md § 关键设计 decision 4).
 *
 * P-FLOW-14 (probe-side): parseYesNo defaultBias=true means garbage judge
 *                          output STOPS probing. Combined with hard maxRounds
 *                          cap, no runaway probes.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProbeStep } from "@merism/contracts";

import {
  buildJudgePrompt,
  buildProbeGenerationPrompt,
  respondentSignaledNoMore,
  runProbeLoop,
  type ProbeRound,
} from "../../../apps/agent-voice-worker/src/interview/flow-engine/index";

function probeStep(overrides: Partial<ProbeStep> = {}): ProbeStep {
  return {
    stepId: "p1",
    kind: "probe",
    outgoingEdgeId: null,
    forQuestionStepId: "q1",
    instruction: "dig into the last answer",
    level: "standard",
    maxRounds: 3,
    ...overrides,
  } as ProbeStep;
}

// ---------------------------------------------------------------------------
// runProbeLoop
// ---------------------------------------------------------------------------

describe("runProbeLoop", () => {
  it("empty instruction → skips probing entirely, returns []", async () => {
    const step = probeStep({ instruction: "" });
    const generateProbe = vi.fn();
    const rounds = await runProbeLoop(step, {
      generateProbe,
      askAndWait: async () => "irrelevant",
      judgeSatisfied: async () => false,
    });
    expect(rounds).toEqual([]);
    expect(generateProbe).not.toHaveBeenCalled();
  });

  it("whitespace-only instruction → treated as empty", async () => {
    const step = probeStep({ instruction: "   \n\t  " });
    const generateProbe = vi.fn();
    const rounds = await runProbeLoop(step, {
      generateProbe,
      askAndWait: async () => "irrelevant",
      judgeSatisfied: async () => false,
    });
    expect(rounds).toEqual([]);
    expect(generateProbe).not.toHaveBeenCalled();
  });

  it("judge satisfied after round 1 → stops with 1 round", async () => {
    const step = probeStep({ maxRounds: 5 });
    let call = 0;
    const rounds = await runProbeLoop(step, {
      generateProbe: async () => `probe-${++call}`,
      askAndWait: async () => "concrete rich answer",
      judgeSatisfied: async () => true,
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toEqual({ probeQuestion: "probe-1", respondentAnswer: "concrete rich answer" });
  });

  it("runs to maxRounds when judge never satisfies", async () => {
    const step = probeStep({ maxRounds: 3 });
    const rounds = await runProbeLoop(step, {
      generateProbe: async () => "probe",
      askAndWait: async () => "more detail",
      judgeSatisfied: async () => false,
    });
    expect(rounds).toHaveLength(3);
  });

  it("maxRounds=1 never calls judge (hard cap, save an LLM roundtrip)", async () => {
    const step = probeStep({ maxRounds: 1 });
    const judgeSatisfied = vi.fn().mockResolvedValue(false);
    const rounds = await runProbeLoop(step, {
      generateProbe: async () => "probe",
      askAndWait: async () => "answer",
      judgeSatisfied,
    });
    expect(rounds).toHaveLength(1);
    expect(judgeSatisfied).not.toHaveBeenCalled();
  });

  it("respondent signals no-more → stops without extra judge call", async () => {
    const step = probeStep({ maxRounds: 5 });
    const judgeSatisfied = vi.fn().mockResolvedValue(false);
    let call = 0;
    const rounds = await runProbeLoop(step, {
      generateProbe: async () => `probe-${++call}`,
      askAndWait: async () => {
        if (call === 1) return "detailed answer";
        return "没有更多补充了。";
      },
      judgeSatisfied,
    });
    // 2 rounds: r1 rich + judge NO + r2 respondent gives no-more → stop.
    expect(rounds).toHaveLength(2);
    // Judge called exactly once (between r1 and r2), not after r2.
    expect(judgeSatisfied).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// respondentSignaledNoMore
// ---------------------------------------------------------------------------

describe("respondentSignaledNoMore", () => {
  it("detects explicit stop phrases (zh + en)", () => {
    expect(respondentSignaledNoMore("没有更多了")).toBe(true);
    expect(respondentSignaledNoMore("我觉得没什么补充")).toBe(true);
    expect(respondentSignaledNoMore("差不多就这些")).toBe(true);
    expect(respondentSignaledNoMore("nothing else, that's all I have")).toBe(true);
    expect(respondentSignaledNoMore("no more to add")).toBe(true);
  });

  it("does NOT trip on rich substantive answers", () => {
    expect(respondentSignaledNoMore("我觉得这个功能有点复杂,尤其是分页那块")).toBe(false);
    expect(respondentSignaledNoMore("")).toBe(false);
    expect(respondentSignaledNoMore("   ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt composition — byte-parity with HANDOFF appendix A
// ---------------------------------------------------------------------------

describe("buildJudgePrompt", () => {
  it("emits the placeholder line when no rounds yet", () => {
    const p = buildJudgePrompt({
      probeInstruction: "understand their pain",
      mainQuestionContent: "How did you feel?",
      mainAnswer: "It was okay",
      rounds: [] as ProbeRound[],
    });
    expect(p).toContain("研究员为这个追问写的目标: understand their pain");
    expect(p).toContain("主问题: How did you feel?");
    expect(p).toContain("用户对主问题的回答: It was okay");
    expect(p).toContain("(还没有追问过)");
    expect(p).toContain("只输出 YES 或 NO");
  });

  it("emits per-round lines when rounds exist", () => {
    const p = buildJudgePrompt({
      probeInstruction: "goal",
      mainQuestionContent: "MQ",
      mainAnswer: "MA",
      rounds: [
        { probeQuestion: "P1", respondentAnswer: "A1" },
        { probeQuestion: "P2", respondentAnswer: "A2" },
      ],
    });
    expect(p).toContain('第 1 轮: 追问="P1" 回答="A1"');
    expect(p).toContain('第 2 轮: 追问="P2" 回答="A2"');
  });
});

describe("buildProbeGenerationPrompt", () => {
  it("first-round variant contains the 'first round' instruction", () => {
    const p = buildProbeGenerationPrompt({
      probeInstruction: "goal",
      mainQuestionContent: "MQ",
      mainAnswer: "MA",
      rounds: [],
    });
    expect(p).toContain("这是第 1 轮追问");
    expect(p).toContain("只输出这一句追问本身");
  });

  it("later-round variant references prior rounds and instructs no repeats", () => {
    const p = buildProbeGenerationPrompt({
      probeInstruction: "goal",
      mainQuestionContent: "MQ",
      mainAnswer: "MA",
      rounds: [{ probeQuestion: "P1", respondentAnswer: "A1" }],
    });
    expect(p).toContain('第 1 轮: 追问="P1" 回答="A1"');
    expect(p).toContain("不要重复已经问过的角度");
  });
});
