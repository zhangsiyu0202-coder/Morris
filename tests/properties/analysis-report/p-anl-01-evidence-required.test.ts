import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { AnalysisReportOutputSchema } from "@merism/contracts";

/**
 * P-ANL-01 — every theme must carry at least one evidence segmentRef.
 *
 * Enforced at the contract level (AnalysisReportOutputSchema themes[].evidence
 * has .min(1)). This PBT exhaustively confirms that contract: any LLM output
 * with at least one empty-evidence theme is rejected, while otherwise-valid
 * outputs pass.
 */
describe("P-ANL-01: every theme has at least one evidence segmentRef", () => {
  const segmentRef = fc.record({
    transcriptId: fc.uuid(),
    segmentIndex: fc.nat({ max: 1000 }),
  });

  const themeWithEvidence = fc.record({
    id: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 40 }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    evidence: fc.array(segmentRef, { minLength: 1, maxLength: 4 }),
  });

  const themeWithEmptyEvidence = fc.record({
    id: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 40 }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    evidence: fc.constant([]),
  });

  function reportWithThemes(themes: unknown[]): unknown {
    return {
      scope: "session",
      themes,
      insights: [],
      citations: [],
      perQuestionSummary: [],
      rendered: null,
    };
  }

  it("schema rejects any report with at least one empty-evidence theme", () => {
    fc.assert(
      fc.property(
        fc.array(themeWithEvidence, { maxLength: 3 }),
        themeWithEmptyEvidence,
        fc.array(themeWithEvidence, { maxLength: 3 }),
        (left, bad, right) => {
          const report = reportWithThemes([...left, bad, ...right]);
          const result = AnalysisReportOutputSchema.safeParse(report);
          expect(result.success).toBe(false);
        },
      ),
    );
  });

  it("schema accepts reports where every theme has >= 1 evidence", () => {
    fc.assert(
      fc.property(fc.array(themeWithEvidence, { minLength: 1, maxLength: 5 }), (themes) => {
        const report = reportWithThemes(themes);
        const result = AnalysisReportOutputSchema.safeParse(report);
        expect(result.success).toBe(true);
      }),
    );
  });
});
