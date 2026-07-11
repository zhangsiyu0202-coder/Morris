import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

import { analyzeSession } from "../../../apps/functions/analyzeSession/src/handler";
import type {
  AnalyzeSessionDeps,
  SessionRecord,
  SurveyContext,
  TranscriptRecord,
} from "../../../apps/functions/analyzeSession/src/handler";
import type { AnalysisReportOutput } from "@merism/contracts";

/**
 * P-ANL-05 — Stored Hallucination-Free 不变量
 *
 * 对任何已落库 (`scope=session`) 的 AnalysisReport, 所有 `themes[].evidence[]`
 * 与 `citations[].segmentRef` 中的 (transcriptId, segmentIndex) 二元组必能在
 * 对应 transcript.segments 中找到。失败的报告**根本不会落库**。
 *
 * Mock 设计 (design §9 / §6 修订版):
 *   path A: mock LLM 一次返回完全 valid → 落库, ratio=0
 *   path B: mock LLM 第一次 bad, 第二次 valid → 落库, ratio=通过那次的 ratio
 *   path C: mock LLM 两次都 bad → 不落库, return 409
 */

const baseSurvey: SurveyContext = {
  surveyId: "sv1",
  ownerUserId: "u",
  title: "T",
  flowConfig: {},
  sections: [],
  questionBlocks: [
    {
      $id: "q1",
      surveyId: "sv1",
      sectionId: "sec1",
      order: 0,
      orderInSection: 0,
      type: "open_ended",
      prompt: "Tell me",
      config: {},
    },
  ],
};

const baseSession: SessionRecord = {
  $id: "sess1",
  surveyId: "sv1",
  state: "completed",
  collectedAnswers: {},
};

function makeTranscript(segmentCount: number): TranscriptRecord {
  return {
    $id: "tx1",
    sessionId: "sess1",
    language: "zh",
    segments: Array.from({ length: segmentCount }, (_, i) => ({
      speaker: i % 2 === 0 ? "interviewer" : "respondent",
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      text: "x".repeat(50), // 让 quality-flags 走规则层 silent (路径与本测试无关)
    })),
  };
}

function buildOutput(refs: Array<{ transcriptId: string; segmentIndex: number }>): AnalysisReportOutput {
  return {
    scope: "session",
    themes: refs.length > 0
      ? [{ id: "t1", label: "x", description: "x", evidence: [refs[0]] }]
      : [{ id: "t1", label: "x", description: "x", evidence: [{ transcriptId: "sess1", segmentIndex: 0 }] }],
    insights: [],
    citations: refs.map((r, i) => ({ segmentRef: r, quote: `q${i}`, themeIds: ["t1"] })),
    perQuestionSummary: [],
    rendered: null,
  };
}

function makeDeps(opts: {
  segmentCount: number;
  llmSeq: AnalysisReportOutput[];
}): AnalyzeSessionDeps & {
  upsertSpy: ReturnType<typeof vi.fn>;
  errSpy: ReturnType<typeof vi.fn>;
} {
  const llmFn = vi.fn();
  for (const out of opts.llmSeq) llmFn.mockResolvedValueOnce(out);
  const upsertSpy = vi.fn(async () => ({ reportId: "ar1" }));
  const errSpy = vi.fn(async () => undefined);
  return {
    now: () => 0,
    findSession: async () => baseSession,
    findTranscript: async () => makeTranscript(opts.segmentCount),
    findSurveyContext: async () => baseSurvey,
    analyzeWithLLM: llmFn,
    deriveQualityFlagsWithLLM: vi.fn(async () => ({ flags: [] })),
    updateInterviewSessionFlags: vi.fn(async () => undefined),
    updateSessionErrorContext: errSpy,
    upsertSessionReport: upsertSpy,
    upsertSpy,
    errSpy,
  } as any;
}

describe("P-ANL-05: stored AnalysisReport has zero hallucinated refs", () => {
  it("path A — first attempt valid → upserted with ok refs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (segmentCount) => {
          const goodRefs = Array.from({ length: 2 }, (_, i) => ({
            transcriptId: "sess1",
            segmentIndex: i % segmentCount,
          }));
          const deps = makeDeps({ segmentCount, llmSeq: [buildOutput(goodRefs)] });
          const r = await analyzeSession({ sessionId: "sess1" }, deps);
          expect(r.status).toBe(200);
          expect(deps.upsertSpy).toHaveBeenCalledOnce();
          // 校验所有落库的 ref 都在 transcript 中
          const body: AnalysisReportOutput = deps.upsertSpy.mock.calls[0][0].body;
          for (const t of body.themes)
            for (const e of t.evidence) expect(e.segmentIndex).toBeLessThan(segmentCount);
          for (const c of body.citations)
            expect(c.segmentRef.segmentIndex).toBeLessThan(segmentCount);
        },
      ),
      { numRuns: 10 },
    );
  });

  it("path C — both attempts fail (>15% bad refs) → not upserted, errorContext written", async () => {
    const bad: AnalysisReportOutput = {
      scope: "session",
      themes: [
        {
          id: "t1",
          label: "x",
          description: "x",
          evidence: [{ transcriptId: "sess1", segmentIndex: 0 }],
        },
      ],
      insights: [],
      citations: Array.from({ length: 5 }, (_, i) => ({
        segmentRef: { transcriptId: "sess1", segmentIndex: 999 + i },
        quote: `q${i}`,
        themeIds: ["t1"],
      })),
      perQuestionSummary: [],
      rendered: null,
    };
    const deps = makeDeps({ segmentCount: 3, llmSeq: [bad, bad] });
    const r = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(r.status).toBe(409);
    expect(deps.upsertSpy).not.toHaveBeenCalled();
    expect(deps.errSpy).toHaveBeenCalledOnce();
    const ctx = deps.errSpy.mock.calls[0][1];
    expect(ctx.reason).toBe("hallucination_threshold_exceeded");
  });
});
