import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import {
  getInsightById,
  getLatestAnalysisReport,
  listInsights,
  listSessions,
  listStudies,
} from "../../../apps/web/lib/queries";
import { makeFakeDatabases } from "../../../apps/web/lib/queries/__tests__/helpers";

/**
 * P-SEC-04 — the read layer never returns rows owned by another researcher.
 *
 * Property: for any (owner, stranger) pair and any document set where some
 * docs belong to owner and some to stranger, queries called with the owner's
 * id MUST NOT include any stranger-owned document in the result, and queries
 * called with the stranger's id MUST NOT include any owner-owned document.
 *
 * The full read layer is tested in apps/web/lib/queries/__tests__/queries.test.ts;
 * this PBT exhausts the ownership boundary across many synthesized fixtures.
 */
describe("P-SEC-04: read layer enforces ownerUserId scoping", () => {
  const makeFixtureSet = (ownerCount: number, strangerCount: number) => {
    const ownerStudies = Array.from({ length: ownerCount }, (_, i) => ({
      $id: `sv-o-${i}`,
      projectId: "p1",
      title: `Owner ${i}`,
      status: "draft" as const,
      flowConfig: {},
      version: 1,
      ownerUserId: "owner",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }));
    const strangerStudies = Array.from({ length: strangerCount }, (_, i) => ({
      $id: `sv-s-${i}`,
      projectId: "p1",
      title: `Stranger ${i}`,
      status: "draft" as const,
      flowConfig: {},
      version: 1,
      ownerUserId: "stranger",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }));
    return [...ownerStudies, ...strangerStudies];
  };

  it("listStudies returns only the caller's surveys", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 })),
        async ([ownerCount, strangerCount]) => {
          const documents = makeFixtureSet(ownerCount, strangerCount);
          const { databases } = makeFakeDatabases({ surveys: { documents } });
          const result = await listStudies("owner", databases);
          expect(result).toHaveLength(ownerCount);
          for (const s of result) expect(s.$id.startsWith("sv-o-")).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("listSessions returns [] when survey is owned by stranger", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (sessionCount) => {
        const sessions = Array.from({ length: sessionCount }, (_, i) => ({
          $id: `sess-${i}`,
          surveyId: "sv1",
          linkId: "lnk1",
          state: "completed" as const,
          livekitRoom: "room",
          collectedAnswers: {},
        }));
        const { databases } = makeFakeDatabases({
          surveys: {
            documents: [
              {
                $id: "sv1",
                projectId: "p1",
                title: "X",
                status: "draft",
                flowConfig: {},
                version: 1,
                ownerUserId: "stranger",
                updatedAt: "2026-06-06T00:00:00.000Z",
              },
            ],
          },
          interview_sessions: { documents: sessions },
        });
        const result = await listSessions("owner", "sv1", databases);
        expect(result).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

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

  it("listInsights / getInsightById never leak stranger-owned insights", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })),
        async ([ownerCount, strangerCount]) => {
          const sample = (id: string, ownerUserId: string) => ({
            $id: id,
            studyId: "sv1",
            studyTitle: "Test",
            question: "Why?",
            headline: "Reason",
            summary: "Because.",
            confidence: "high" as const,
            sampleSize: 5,
            ownerUserId,
            createdAt: "2026-06-06T00:00:00.000Z",
            report: JSON.stringify({
              headline: "Reason",
              directAnswer: "Because.",
              confidence: "high",
              confidenceReason: "n/a",
              themes: [],
              divergences: [],
              actions: [],
            }),
          });
          const documents = [
            ...Array.from({ length: ownerCount }, (_, i) => sample(`i-o-${i}`, "owner")),
            ...Array.from({ length: strangerCount }, (_, i) => sample(`i-s-${i}`, "stranger")),
          ];
          const { databases } = makeFakeDatabases({ insights: { documents } });

          const list = await listInsights("owner", databases);
          expect(list).toHaveLength(ownerCount);
          for (const item of list) expect(item.ownerUserId).toBe("owner");

          // Try to read a stranger-owned insight via getInsightById as owner.
          for (let i = 0; i < strangerCount; i++) {
            const result = await getInsightById("owner", `i-s-${i}`, databases);
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
