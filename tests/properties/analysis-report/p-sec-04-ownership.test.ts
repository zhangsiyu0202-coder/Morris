import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getLatestAnalysisReport } from "../../../apps/web/lib/queries/reports";
import { makeFakeDatabases } from "../../../apps/web/lib/queries/__tests__/helpers";

/**
 * P-SEC-04 (analysis-report): the report read never returns another owner's
 * report. `getLatestAnalysisReport` is still an API-key read filtered by
 * `ownerUserId` (the report viewer resolves the study's author and reads that
 * author's report), so this in-code ownership property remains meaningful.
 *
 * The workspace-entity reads (surveys/sessions/notebooks/bookmarks/transcripts)
 * moved to the user session client under ADR-0006 (B): Appwrite enforces tenant
 * isolation natively via Role.user / Role.team document permissions, so their
 * isolation invariant is verified end-to-end against the live Appwrite stack
 * (scripts/_verify-native-reads.mjs style), not by an in-process fake here.
 */
describe("P-SEC-04: report read enforces ownerUserId scoping", () => {
  it("getLatestAnalysisReport never returns a stranger-owned report", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 })),
        async ([ownerReports, strangerReports]) => {
          const owner = Array.from({ length: ownerReports }, (_, i) => ({
            $id: `ar-o-${i}`,
            surveyId: "sv1",
            scope: "survey",
            ownerUserId: "owner",
            themes: "[]",
            insights: "[]",
            citations: "[]",
            generatedAt: `2026-06-06T0${i}:00:00.000Z`,
          }));
          const stranger = Array.from({ length: strangerReports }, (_, i) => ({
            $id: `ar-s-${i}`,
            surveyId: "sv1",
            scope: "survey",
            ownerUserId: "stranger",
            themes: "[]",
            insights: "[]",
            citations: "[]",
            generatedAt: `2026-06-06T1${i}:00:00.000Z`,
          }));
          const { databases } = makeFakeDatabases({
            analysis_reports: { documents: [...stranger, ...owner] },
          });
          const result = await getLatestAnalysisReport(
            "owner",
            { surveyId: "sv1", scope: "survey" },
            databases,
          );
          if (ownerReports === 0) {
            expect(result).toBeNull();
          } else {
            expect(result).not.toBeNull();
            expect(result?.$id?.startsWith("ar-o-")).toBe(true);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
