import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  NotebookSchema,
  notebookReportSchema,
  type Notebook,
  type NotebookReport,
} from "@merism/contracts";

/**
 * P-NB-01b — Wave B 新字段默认值 fallback round-trip.
 *
 * 对任意"Wave A 阶段写入的 Notebook"(无 shortId / content / textContent /
 * embedding / embeddingModel 字段, 仅有旧 fixed-shape report), Wave B schema
 * 演进后能以默认值 fallback 读出 + NotebookSchema.parse 通过(content="" /
 * textContent="" / embedding="" / shortId="" / visibility="internal")。
 *
 * 锁定: Wave A → Wave B 升级期, 旧数据不会因 schema 演进而 parse 失败。
 *
 * 后端 lazy-fill shortId 路径(R3.7 / design §9.1)在 saveNotebookFromMarkdown
 * 实施时验证, 这里只验证 schema-level fallback 不破。
 */
describe("P-NB-01b: Wave B fallback defaults — Wave A row reads with new schema", () => {
  const reportArb: fc.Arbitrary<NotebookReport> = fc.record({
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

  /**
   * Wave A 阶段写入的 Notebook document — 只有旧字段 (Wave A 之前的 Insight
   * 字段集 + 字面 rename), 没有 shortId / content / textContent / embedding /
   * visibility / embeddingModel 这些 Wave B 新字段。
   */
  const waveAResidualDocArb = fc.record({
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

  it("Wave A row (no new fields) parses through Wave B NotebookSchema with defaults", () => {
    fc.assert(
      fc.property(waveAResidualDocArb, (doc) => {
        const parsed = NotebookSchema.safeParse(doc);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          const nb: Notebook = parsed.data;
          // Wave B fallback defaults applied:
          expect(nb.shortId).toBe("");
          expect(nb.content).toBe("");
          expect(nb.textContent).toBe("");
          expect(nb.visibility).toBe("internal");
          expect(nb.embedding).toBe("");
          expect(nb.embeddingModel).toBe("");
          // 旧字段 untouched:
          expect(nb.headline).toBe(doc.headline);
          expect(nb.report).toEqual(doc.report);
        }
      }),
    );
  });

  it("Wave A row with explicit empty-string overrides also parses to same defaults", () => {
    fc.assert(
      fc.property(waveAResidualDocArb, (doc) => {
        // 模拟: Wave B 上线后 schema:apply 已经把 attribute 加上, default ""
        // 已应用; Appwrite 会返回这些字段为空字符串而不是 undefined。
        const docWithDefaults = {
          ...doc,
          shortId: "",
          content: "",
          textContent: "",
          embedding: "",
          embeddingModel: "",
          // visibility default "internal" (enum) — Appwrite 行为是返回 default 值
          visibility: "internal" as const,
        };
        const parsed = NotebookSchema.safeParse(docWithDefaults);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.shortId).toBe("");
          expect(parsed.data.visibility).toBe("internal");
        }
      }),
    );
  });

  it("notebookReportSchema unchanged — Wave A reports still parse identically", () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const parsed = notebookReportSchema.safeParse(report);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data).toEqual(report);
        }
      }),
    );
  });

  it("Notebook.report can be null (Wave D forward-compat)", () => {
    fc.assert(
      fc.property(waveAResidualDocArb, (doc) => {
        const docNullReport = { ...doc, report: null };
        const parsed = NotebookSchema.safeParse(docNullReport);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.report).toBe(null);
        }
      }),
    );
  });
});
