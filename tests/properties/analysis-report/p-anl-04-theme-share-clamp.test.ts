import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { analyzeSurvey } from "../../../apps/functions/analyzeSurvey/src/handler";
import type {
  AnalyzeSurveyDeps,
  LlmRollupOutput,
} from "../../../apps/functions/analyzeSurvey/src/handler";

/**
 * P-ANL-04 — sum(themes[].pct) <= 100 for survey-level reports.
 *
 * The handler's clampThemeShare is invoked unconditionally before persisting,
 * so however the LLM mis-reports (deliberately or accidentally) we should
 * never persist a sum > 100 + small float slack.
 */
describe("P-ANL-04: handler clamps total theme share to <= 100%", () => {
  const themeArb = fc.record({
    id: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 30 }),
    mentions: fc.nat({ max: 50 }),
    pct: fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true }),
    sentiment: fc.constantFrom("positive", "neutral", "negative") as fc.Arbitrary<
      "positive" | "neutral" | "negative"
    >,
  });

  function makeDeps(themes: LlmRollupOutput["themes"]): AnalyzeSurveyDeps {
    const llm: LlmRollupOutput = {
      themes,
      insights: [],
      citations: [],
      sentimentBreakdown: [],
      topics: [],
      questionSummaries: {},
    };
    return {
      now: () => 0,
      findSurveyContext: async () => ({
        surveyId: "sv1",
        ownerUserId: "u",
        title: "T",
        questionBlocks: [],
        topics: [],
      }),
      findCompletedSessions: async () => [
        { sessionId: "s1", transcriptId: "t1", state: "completed", answers: [] },
      ],
      findSessionReports: async () => [
        {
          reportId: "ar-1",
          sessionId: "s1",
          themes: [],
          insights: [],
          citations: [],
          perQuestionSummary: [],
        },
      ],
      rollupWithLLM: vi.fn(async () => llm),
      upsertSurveyReport: vi.fn(async () => ({ reportId: "ar-survey" })),
    };
  }

  it("after handler runs, sum(themes[].pct) <= 100 + small float slack", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(themeArb, { maxLength: 12 }), async (themes) => {
        const upsertSpy = vi.fn(async () => ({ reportId: "ar-survey" }));
        const deps = { ...makeDeps(themes), upsertSurveyReport: upsertSpy };
        const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
        expect(result.status).toBe(200);
        const stored = upsertSpy.mock.calls[0]?.[0]?.body.themes ?? [];
        const sum = stored.reduce((acc: number, t: { pct: number }) => acc + t.pct, 0);
        expect(sum).toBeLessThanOrEqual(100.01);
      }),
      { numRuns: 100 },
    );
  });
});
