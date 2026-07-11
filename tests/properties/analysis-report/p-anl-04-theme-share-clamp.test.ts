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
 * P-ANL-04 — sum(themes[].pct) <= 100 for survey-level reports.
 *
 * In v2, themes/mentions/pct are computed by enrichSurveyThemes (pure) from
 * ExtractedThemes + ThemeAssignments + totalSessions. The pure function is
 * responsible for clamping to <= 1.0 (P-ANL-04). PBT exercises the full
 * handler path so we know the clamp survives all the way to upsert.
 */
describe("P-ANL-04: handler clamps total theme share to <= 100%", () => {
  // Fast-check arbitrary: N themes, each with arbitrary sessionIds within a
  // shared totalSessions universe. mentions = sessionIds.length; pct = mentions/total.
  // By picking sessionIds non-disjointly across themes we naturally generate
  // sum > 100% cases that need clamping.
  const themeAssignArb = (totalSessions: number) =>
    fc.array(
      fc.record({
        themeId: fc.string({ minLength: 1, maxLength: 8 }),
        sessionIds: fc.array(
          fc.integer({ min: 0, max: Math.max(0, totalSessions - 1) }).map((i) => `s${i}`),
          { maxLength: totalSessions },
        ),
      }),
      { maxLength: 12 },
    );

  function makeDeps(
    extracted: ExtractedThemes,
    assignments: ThemeAssignments,
    totalSessions: number,
  ): AnalyzeSurveyDeps {
    const sessions: SessionDigest[] = Array.from({ length: totalSessions }, (_, i) => ({
      sessionId: `s${i}`,
      transcriptId: `t${i}`,
      state: "completed" as const,
      answers: [],
    }));
    const reports: SessionLevelReport[] = sessions.map((s) => ({
      reportId: `ar-${s.sessionId}`,
      sessionId: s.sessionId,
      themes: [],
      insights: [],
      citations: [],
      perQuestionSummary: [],
    }));
    const compose: ComposeInsightsOutput = {
      insights: [],
      citations: [],
      topics: [],
      sentimentBreakdown: [],
      themeSentiments: Object.fromEntries(
        extracted.themes.map((t) => [t.id, "neutral" as const]),
      ),
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
      findCompletedSessions: async () => sessions,
      findSessionReports: async () => reports,
      extractThemesWithLLM: vi.fn(async () => extracted),
      combineThemesWithLLM: vi.fn(async (input: any) => input.rawThemesList[0] ?? extracted),
      assignThemesWithLLM: vi.fn(async () => assignments),
      composeInsightsWithLLM: vi.fn(async () => compose),
      upsertSurveyReport: vi.fn(async () => ({ reportId: "ar-survey" })),
    };
  }

  it("after handler runs, sum(themes[].pct) <= 100 + small float slack", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (totalSessions) => {
          const themesUniqueArb = fc
            .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 10 })
            .filter((arr) => arr.length > 0);

          await fc.assert(
            fc.asyncProperty(
              themesUniqueArb.chain((ids) =>
                fc.tuple(
                  fc.constant(ids),
                  fc.array(
                    fc.array(
                      fc.integer({ min: 0, max: totalSessions - 1 }).map((i) => `s${i}`),
                      { maxLength: totalSessions },
                    ),
                    { minLength: ids.length, maxLength: ids.length },
                  ),
                ),
              ),
              async ([ids, sessionIdLists]) => {
                const extracted: ExtractedThemes = {
                  themes: ids.map((id) => ({ id, label: id, description: "" })),
                };
                const assignments: ThemeAssignments = {
                  assignments: ids.map((id, i) => ({
                    themeId: id,
                    sessionIds: Array.from(new Set(sessionIdLists[i] ?? [])),
                    evidenceRefs: [],
                  })),
                };
                const upsertSpy = vi.fn(async () => ({ reportId: "ar-survey" }));
                const deps = {
                  ...makeDeps(extracted, assignments, totalSessions),
                  upsertSurveyReport: upsertSpy,
                };
                const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
                expect(result.status).toBe(200);
                const stored = upsertSpy.mock.calls[0]?.[0]?.body.themes ?? [];
                const sum = stored.reduce(
                  (acc: number, t: { pct: number }) => acc + t.pct,
                  0,
                );
                expect(sum).toBeLessThanOrEqual(100.5);
              },
            ),
            { numRuns: 5 },
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});
