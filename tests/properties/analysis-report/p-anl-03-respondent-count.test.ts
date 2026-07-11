import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { analyzeSurvey } from "../../../apps/functions/analyzeSurvey/src/handler";
import type {
  AnalyzeSurveyDeps,
  SessionDigest,
  SessionLevelReport,
} from "../../../apps/functions/analyzeSurvey/src/handler";
import type {
  ComposeInsightsOutput,
  ExtractedThemes,
  ThemeAssignments,
} from "../../../apps/functions/analyzeSurvey/src/rollup";

/**
 * P-ANL-03 — body.completedRespondents equals the number of completed
 * sessions known to the handler.
 *
 * This is a structural invariant of analyzeSurvey: the survey-level rollup
 * must report a sample size matching what was rolled up.
 */
describe("P-ANL-03: completedRespondents equals count of completed sessions", () => {
  const sessionArb = (n: number): SessionDigest[] =>
    Array.from({ length: n }, (_, i) => ({
      sessionId: `s${i}`,
      transcriptId: `t${i}`,
      state: "completed" as const,
      answers: [],
    }));

  const reportArb = (n: number): SessionLevelReport[] =>
    Array.from({ length: n }, (_, i) => ({
      reportId: `ar-${i}`,
      sessionId: `s${i}`,
      themes: [],
      insights: [],
      citations: [],
      perQuestionSummary: [],
    }));

  function makeDeps(n: number): AnalyzeSurveyDeps {
    const extracted: ExtractedThemes = { themes: [] };
    const assignments: ThemeAssignments = { assignments: [] };
    const compose: ComposeInsightsOutput = {
      insights: [],
      citations: [],
      topics: [],
      sentimentBreakdown: [],
      themeSentiments: {},
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
      findCompletedSessions: async () => sessionArb(n),
      findSessionReports: async () => reportArb(n),
      extractThemesWithLLM: vi.fn(async () => extracted),
      combineThemesWithLLM: vi.fn(async (input: any) => input.rawThemesList[0] ?? extracted),
      assignThemesWithLLM: vi.fn(async () => assignments),
      composeInsightsWithLLM: vi.fn(async () => compose),
      upsertSurveyReport: vi.fn(async () => ({ reportId: "ar-survey" })),
    };
  }

  it("body.completedRespondents == #completed sessions", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (n) => {
        const upsertSpy = vi.fn(async () => ({ reportId: "ar-survey" }));
        const deps = { ...makeDeps(n), upsertSurveyReport: upsertSpy };
        const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
        expect(result.status).toBe(200);
        const body = upsertSpy.mock.calls[0]?.[0]?.body;
        expect(body.completedRespondents).toBe(n);
        expect(body.totalRespondents).toBe(n);
      }),
      { numRuns: 30 },
    );
  });

  it("filters out non-completed sessions before counting", async () => {
    const n = 5;
    const mixed: SessionDigest[] = [
      ...sessionArb(n),
      { sessionId: "ip1", transcriptId: "t-ip", state: "in_progress", answers: [] },
      { sessionId: "ab1", transcriptId: "t-ab", state: "abandoned", answers: [] },
    ];
    const upsertSpy = vi.fn(async () => ({ reportId: "ar-survey" }));
    const deps: AnalyzeSurveyDeps = {
      ...makeDeps(n),
      findCompletedSessions: async () => mixed,
      upsertSurveyReport: upsertSpy,
    };
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(200);
    expect(upsertSpy.mock.calls[0]?.[0]?.body.completedRespondents).toBe(n);
  });
});
