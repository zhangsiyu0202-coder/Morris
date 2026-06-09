import { describe, it, expect, vi } from "vitest";

import {
  deriveQualityFlags,
  deriveQualityFlagsRule,
  enforceMutex,
  shouldRunLLMStage,
  type DeriveQualityFlagsLLM,
} from "../src/quality-flags.js";
import type { SurveyContext, TranscriptRecord } from "../src/handler.js";

function makeTranscript(parts: Array<{ speaker: string; text: string; ms?: number }>): TranscriptRecord {
  let t = 0;
  return {
    $id: "tx1",
    sessionId: "s1",
    language: "zh",
    segments: parts.map((p) => {
      const startMs = t;
      const dur = p.ms ?? 1000;
      t += dur;
      return { speaker: p.speaker, startMs, endMs: startMs + dur, text: p.text };
    }),
  };
}

const surveyContext: SurveyContext = {
  surveyId: "sv1",
  ownerUserId: "u1",
  title: "test survey",
  flowConfig: {},
  sections: [],
  questionBlocks: [],
};

describe("deriveQualityFlagsRule", () => {
  it("returns silent when respondent says nothing", () => {
    const transcript = makeTranscript([{ speaker: "interviewer", text: "你好,请问..." }]);
    expect(deriveQualityFlagsRule({ transcript, totalDurationMs: 5_000 })).toEqual(["silent"]);
  });

  it("returns silent when respondent text < 50 chars", () => {
    const transcript = makeTranscript([
      { speaker: "interviewer", text: "你好,请问..." },
      { speaker: "respondent", text: "嗯。" },
    ]);
    expect(deriveQualityFlagsRule({ transcript, totalDurationMs: 5_000 })).toEqual(["silent"]);
  });

  it("returns too-short when respondent text 50..200 chars", () => {
    const long = "x".repeat(120);
    const transcript = makeTranscript([
      { speaker: "interviewer", text: "你好" },
      { speaker: "respondent", text: long },
    ]);
    expect(deriveQualityFlagsRule({ transcript, totalDurationMs: 5_000 })).toEqual(["too-short"]);
  });

  it("returns no mechanical flag for a normal-length conversation", () => {
    const long = "x".repeat(500);
    const transcript = makeTranscript([
      { speaker: "interviewer", text: "你好" },
      { speaker: "respondent", text: long },
    ]);
    expect(deriveQualityFlagsRule({ transcript, totalDurationMs: 5_000 })).toEqual([]);
  });

  it("appends too-long when total duration > 60min", () => {
    const long = "x".repeat(500);
    const transcript = makeTranscript([
      { speaker: "respondent", text: long },
    ]);
    expect(deriveQualityFlagsRule({ transcript, totalDurationMs: 90 * 60_000 })).toEqual(["too-long"]);
  });
});

describe("shouldRunLLMStage", () => {
  it("skips LLM when silent", () => {
    expect(shouldRunLLMStage(["silent"])).toBe(false);
  });
  it("skips LLM when too-short", () => {
    expect(shouldRunLLMStage(["too-short"])).toBe(false);
  });
  it("runs LLM when no mechanical signal blocks it", () => {
    expect(shouldRunLLMStage([])).toBe(true);
    expect(shouldRunLLMStage(["too-long"])).toBe(true);
  });
});

describe("enforceMutex", () => {
  it("removes semantic flag when mechanical conflicts", () => {
    expect(enforceMutex(["silent", "fluent"])).toEqual(["silent"]);
    expect(enforceMutex(["silent", "deep-engagement"])).toEqual(["silent"]);
    expect(enforceMutex(["too-short", "deep-engagement"])).toEqual(["too-short"]);
  });

  it("removes semantic-vs-semantic per list order (fluent stays, shallow drops)", () => {
    expect(enforceMutex(["fluent", "shallow"])).toEqual(["fluent"]);
  });

  it("preserves orthogonal flags", () => {
    expect(enforceMutex(["fluent", "refused-topic"])).toEqual(["fluent", "refused-topic"]);
  });

  it("dedupes", () => {
    const out = enforceMutex(["silent", "silent"]);
    expect(out).toEqual(["silent"]);
  });
});

describe("deriveQualityFlags (full pipeline)", () => {
  it("LLM is skipped when silent", async () => {
    const llm = vi.fn<DeriveQualityFlagsLLM>(async () => ({ flags: ["fluent"] }));
    const transcript = makeTranscript([{ speaker: "interviewer", text: "..." }]);
    const out = await deriveQualityFlags({
      transcript,
      surveyContext,
      totalDurationMs: 5_000,
      llm,
    });
    expect(out).toEqual(["silent"]);
    expect(llm).not.toHaveBeenCalled();
  });

  it("merges mechanical + LLM flags then enforces mutex", async () => {
    const llm = vi.fn<DeriveQualityFlagsLLM>(async () => ({
      flags: ["off-topic", "shallow", "fluent"],
    }));
    const long = "x".repeat(500);
    const transcript = makeTranscript([{ speaker: "respondent", text: long }]);
    const out = await deriveQualityFlags({
      transcript,
      surveyContext,
      totalDurationMs: 5_000,
      llm,
    });
    // shallow 与 fluent 互斥 — 列表中 fluent 在前(规则:首先出现的留下),所以 shallow 删
    expect(out).toContain("off-topic");
    expect(out).toContain("fluent");
    expect(out).not.toContain("shallow");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("LLM throw → falls back to rule flags only", async () => {
    const llm: DeriveQualityFlagsLLM = async () => {
      throw new Error("LLM down");
    };
    const long = "x".repeat(500);
    const transcript = makeTranscript([{ speaker: "respondent", text: long }]);
    const out = await deriveQualityFlags({
      transcript,
      surveyContext,
      totalDurationMs: 90 * 60_000,
      llm,
    });
    expect(out).toEqual(["too-long"]);
  });
});
