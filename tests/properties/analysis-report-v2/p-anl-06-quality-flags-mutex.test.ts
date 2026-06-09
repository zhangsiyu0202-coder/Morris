import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

import {
  deriveQualityFlags,
  enforceMutex,
  type DeriveQualityFlagsLLM,
} from "../../../apps/functions/analyzeSession/src/quality-flags";
import type {
  SurveyContext,
  TranscriptRecord,
} from "../../../apps/functions/analyzeSession/src/handler";
import {
  InterviewSessionSchema,
  SessionQualityFlagSchema,
  type SessionQualityFlag,
} from "@merism/contracts";

/**
 * P-ANL-06 — qualityFlags 互斥规则不变量
 *
 * (1) 输出永不同时含 mutex 表中的对 (silent×fluent / silent×deep-engagement /
 *     too-short×deep-engagement / fluent×shallow)
 * (2) mechanical flags (silent / too-short / too-long) 一旦命中, 与之冲突的
 *     semantic flag 必被剔除
 * (3) InterviewSessionSchema.parse({ ..., qualityFlags: 输出 }) 必通过
 */

const ALL_FLAGS = SessionQualityFlagSchema.options;
const MUTEX = [
  ["silent", "fluent"],
  ["silent", "deep-engagement"],
  ["too-short", "deep-engagement"],
  ["fluent", "shallow"],
] as const;

const surveyContext: SurveyContext = {
  surveyId: "sv1",
  ownerUserId: "u",
  title: "T",
  flowConfig: {},
  sections: [],
  questionBlocks: [],
};

function makeTranscript(respondentChars: number, durationMs: number): TranscriptRecord {
  return {
    $id: "tx1",
    sessionId: "s1",
    language: "zh",
    segments: [
      { speaker: "interviewer", startMs: 0, endMs: 1000, text: "..." },
      {
        speaker: "respondent",
        startMs: 1000,
        endMs: 1000 + durationMs,
        text: "x".repeat(respondentChars),
      },
    ],
  };
}

describe("P-ANL-06: qualityFlags mutex invariants", () => {
  it("enforceMutex never returns a forbidden pair", () => {
    const flagSubset = fc
      .uniqueArray(fc.constantFrom<SessionQualityFlag>(...ALL_FLAGS), { maxLength: ALL_FLAGS.length })
      .map((arr) => arr as SessionQualityFlag[]);
    fc.assert(
      fc.property(flagSubset, (flags) => {
        const out = enforceMutex(flags);
        const set = new Set(out);
        for (const [a, b] of MUTEX) {
          if (set.has(a) && set.has(b)) return false;
        }
        // 同 superRefine: schema 必能 parse 含此 qualityFlags 的会话
        const session = {
          $id: "s1",
          surveyId: "sv1",
          linkId: "l1",
          state: "completed" as const,
          livekitRoom: "room",
          collectedAnswers: {},
          qualityFlags: out,
        };
        return InterviewSessionSchema.safeParse(session).success;
      }),
      { numRuns: 200 },
    );
  });

  it("rule layer 命中 mechanical 时, 冲突 semantic 必被剔除", async () => {
    // 给定 silent (规则触发, 受访者文本 < 50 字符), 让 LLM 强行返 fluent + deep-engagement
    const llm: DeriveQualityFlagsLLM = async () => ({
      flags: ["fluent", "deep-engagement", "off-topic"],
    });
    const out = await deriveQualityFlags({
      transcript: makeTranscript(10, 5_000),
      surveyContext,
      totalDurationMs: 5_000,
      llm,
    });
    expect(out).toContain("silent");
    // 但实际 silent 触发时 LLM 会被跳过 (D10), out 应该只有 ["silent"]
    // 这条测试同时验证了 D10 短路语义。
    expect(out).toEqual(["silent"]);
  });

  it("schema parse 接受 enforceMutex 任意输出 (P-ANL-06 兜底)", () => {
    const flagSubset = fc
      .uniqueArray(fc.constantFrom<SessionQualityFlag>(...ALL_FLAGS), { maxLength: ALL_FLAGS.length })
      .map((arr) => arr as SessionQualityFlag[]);
    fc.assert(
      fc.property(flagSubset, (flags) => {
        const out = enforceMutex(flags);
        const session = {
          $id: "s1",
          surveyId: "sv1",
          linkId: "l1",
          state: "completed" as const,
          livekitRoom: "room",
          collectedAnswers: {},
          qualityFlags: out,
        };
        const result = InterviewSessionSchema.safeParse(session);
        return result.success === true;
      }),
      { numRuns: 100 },
    );
  });
});
