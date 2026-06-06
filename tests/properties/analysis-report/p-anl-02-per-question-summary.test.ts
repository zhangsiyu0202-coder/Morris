import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { AnalysisReportOutputSchema } from "@merism/contracts";

/**
 * P-ANL-02 — every question in the survey gets a perQuestionSummary entry.
 *
 * The contract layer cannot tighten this with a refinement (the survey
 * structure and the report output live in separate inputs), so this PBT
 * operates at the schema boundary plus a relational invariant: the report's
 * perQuestionSummary[].questionId set must be a superset of every
 * question id supplied to the analyzer.
 */
describe("P-ANL-02: every question in the survey is summarized", () => {
  const reportFor = (questionIds: string[], extraIds: string[] = []) => {
    const summaries = [...questionIds, ...extraIds].map((qid) => ({
      questionId: qid,
      summary: "...",
      sentiment: "neutral",
    }));
    return {
      scope: "session" as const,
      themes: [
        {
          id: "t1",
          label: "T",
          description: "d",
          evidence: [{ transcriptId: "t", segmentIndex: 0 }],
        },
      ],
      insights: [],
      citations: [],
      perQuestionSummary: summaries,
      rendered: null,
    };
  };

  it("schema accepts a report when every input question id has a summary", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }),
        (questionIds) => {
          const report = reportFor(questionIds);
          const parsed = AnalysisReportOutputSchema.safeParse(report);
          expect(parsed.success).toBe(true);
          if (parsed.success) {
            const covered = new Set(
              parsed.data.perQuestionSummary.map((s) => s.questionId),
            );
            for (const qid of questionIds) {
              expect(covered.has(qid)).toBe(true);
            }
          }
        },
      ),
    );
  });

  it("relational invariant: missing question ids are detectable", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 8 }),
        (questionIds) => {
          // Drop one id — the relational invariant should fail.
          const dropped = questionIds.slice(1);
          const report = reportFor(dropped);
          const parsed = AnalysisReportOutputSchema.safeParse(report);
          // Schema still parses — perQuestionSummary array structure is
          // valid. The relational P-ANL-02 invariant is the *consumer's*
          // responsibility to verify (this test documents that gap).
          expect(parsed.success).toBe(true);
          const covered = new Set(
            (parsed.success ? parsed.data.perQuestionSummary : []).map((s) => s.questionId),
          );
          // Verifier semantics: should this report be accepted by the
          // analyze pipeline? No — the dropped question is uncovered.
          expect(covered.has(questionIds[0]!)).toBe(false);
        },
      ),
    );
  });
});
