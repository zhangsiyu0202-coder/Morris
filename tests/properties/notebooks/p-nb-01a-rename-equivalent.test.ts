import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  NotebookSchema,
  notebookReportSchema,
  // Backward-compat aliases (Wave A); removed in Wave F.
  InsightSchema,
  insightReportSchema,
  type Insight,
  type Notebook,
} from "@merism/contracts";

/**
 * P-NB-01a — Wave A 字段集等价 round-trip.
 *
 * 对任意"旧 Insight document", Wave A 字面 rename 后能以**完全相同**字段集读出
 * 为 Notebook (headline / themes / divergences / actions / report 等所有字段
 * 一一映射, 没有任何丢失). 锁定 Wave A rename 不丢字段。
 *
 * Wave B 加 shortId / content / textContent / embedding 等新字段后, 旧数据
 * fallback 由 P-NB-01b 锁定 (Wave B 末尾再写)。
 */
describe("P-NB-01a: Wave A rename Insight ↔ Notebook field-set equivalence", () => {
  const reportArb = fc.record({
    headline: fc.string({ minLength: 1, maxLength: 200 }),
    directAnswer: fc.string({ minLength: 1, maxLength: 500 }),
    confidence: fc.constantFrom("high", "medium", "low" as const),
    confidenceReason: fc.string({ minLength: 1, maxLength: 200 }),
    themes: fc.array(
      fc.record({
        title: fc.string({ minLength: 1, maxLength: 80 }),
        analysis: fc.string({ minLength: 1, maxLength: 600 }),
        quotes: fc.array(fc.string({ minLength: 1, maxLength: 200 }), {
          minLength: 0,
          maxLength: 3,
        }),
      }),
      { minLength: 0, maxLength: 4 },
    ),
    divergences: fc.array(
      fc.record({
        group: fc.string({ minLength: 1, maxLength: 80 }),
        stance: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      { minLength: 0, maxLength: 3 },
    ),
    actions: fc.array(
      fc.record({
        priority: fc.constantFrom("P0", "P1", "P2" as const),
        action: fc.string({ minLength: 1, maxLength: 200 }),
        rationale: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      { minLength: 0, maxLength: 4 },
    ),
  });

  const insightDocArb = fc.record({
    $id: fc.string({ minLength: 1, maxLength: 36 }),
    studyId: fc.string({ minLength: 1, maxLength: 64 }),
    studyTitle: fc.string({ minLength: 1, maxLength: 200 }),
    question: fc.string({ minLength: 1, maxLength: 400 }),
    headline: fc.string({ minLength: 1, maxLength: 200 }),
    summary: fc.string({ minLength: 1, maxLength: 1000 }),
    confidence: fc.constantFrom("high", "medium", "low" as const),
    sampleSize: fc.integer({ min: 0, max: 1000 }),
    report: reportArb,
    ownerUserId: fc.string({ minLength: 1, maxLength: 64 }),
    createdAt: fc
      .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
      .map((d) => d.toISOString()),
  });

  it("InsightSchema (alias) and NotebookSchema accept the same documents", () => {
    fc.assert(
      fc.property(insightDocArb, (doc) => {
        const insightParsed = InsightSchema.safeParse(doc);
        const notebookParsed = NotebookSchema.safeParse(doc);
        // Both schemas must accept (or both reject) the same document.
        expect(insightParsed.success).toBe(notebookParsed.success);
        if (insightParsed.success && notebookParsed.success) {
          // And the parsed value must be field-for-field identical.
          expect(insightParsed.data).toEqual(notebookParsed.data);
        }
      }),
    );
  });

  it("notebookReportSchema and insightReportSchema (alias) are field-equivalent", () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const a = insightReportSchema.safeParse(report);
        const b = notebookReportSchema.safeParse(report);
        expect(a.success).toBe(b.success);
        if (a.success && b.success) {
          expect(a.data).toEqual(b.data);
        }
      }),
    );
  });

  it("Insight type alias is structurally identical to Notebook (compile-time)", () => {
    // Compile-time: both types are the same. If the alias drifts, this won't
    // compile. (Can't assert at runtime since types are erased.)
    const sample: Insight = {} as Notebook;
    const sample2: Notebook = {} as Insight;
    expect(typeof sample).toBe("object");
    expect(typeof sample2).toBe("object");
  });
});
