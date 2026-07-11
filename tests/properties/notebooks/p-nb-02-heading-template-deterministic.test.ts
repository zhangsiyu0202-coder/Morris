import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractCardSections,
  REQUIRED_H2_SECTIONS,
} from "../../../apps/web/lib/notebooks/heading-template";
import type { ProseMirrorDoc } from "../../../apps/web/lib/notebooks/types";

/**
 * P-NB-02 — heading-template extractor is deterministic.
 *
 * - 给任意符合 5 段模板 (# H1 + 4 个固定 H2 顺序对齐) 的 ProseMirrorDoc,
 *   `extractCardSections` 必返回非空 CardSections, 且每个 H2 的 blocks 数
 *   等于该 section 实际出现的 paragraph 数.
 * - 给任意"模板被破坏"(缺段 / 顺序乱 / 多 H1 / 无 H1 / 未知 H2 label)
 *   的 doc, 必返回 null.
 * - 同一 doc 多次调用结果一致 (deterministic, no hidden state).
 *
 * 这是卡片视图的健壮性保证: 模板未严格命中 → 前端退化为"切到文档视图查看",
 * 不会渲染半 broken 卡片。
 */

function h1(text: string): ProseMirrorDoc["content"][number] {
  return { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] };
}
function h2(text: string): ProseMirrorDoc["content"][number] {
  return { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] };
}
function p(text: string): ProseMirrorDoc["content"][number] {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const validQuestionArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const paragraphTextArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

function buildValidDoc(
  question: string,
  introCount: number,
  bodyCounts: [number, number, number, number],
  paragraphTexts: string[],
): ProseMirrorDoc {
  const blocks: ProseMirrorDoc["content"] = [h1(question)];
  let i = 0;
  for (let k = 0; k < introCount; k++) {
    blocks.push(p(paragraphTexts[i++ % paragraphTexts.length]!));
  }
  for (let s = 0; s < REQUIRED_H2_SECTIONS.length; s++) {
    blocks.push(h2(REQUIRED_H2_SECTIONS[s]!));
    for (let k = 0; k < bodyCounts[s]!; k++) {
      blocks.push(p(paragraphTexts[i++ % paragraphTexts.length]!));
    }
  }
  return { type: "doc", content: blocks };
}

describe("P-NB-02: extractCardSections is deterministic + complete-template iff non-null", () => {
  it("complete template → non-null CardSections, intro/section blocks match counts", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          validQuestionArb,
          fc.integer({ min: 0, max: 3 }),
          fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 4 }),
          ),
          fc.array(paragraphTextArb, { minLength: 20, maxLength: 30 }),
        ),
        ([question, introCount, bodyCounts, texts]) => {
          const doc = buildValidDoc(question, introCount, bodyCounts, texts);
          const out = extractCardSections(doc);
          expect(out).not.toBeNull();
          if (!out) return;
          // extractCardSections trims whitespace around the heading text.
          expect(out.question).toBe(question.trim());
          expect(out.intro).toHaveLength(introCount);
          for (let i = 0; i < REQUIRED_H2_SECTIONS.length; i++) {
            const label = REQUIRED_H2_SECTIONS[i]!;
            expect(out.sections[label]).toHaveLength(bodyCounts[i]!);
          }
          // Idempotent
          const out2 = extractCardSections(doc);
          expect(out2).toEqual(out);
        },
      ),
    );
  });

  it("missing one of the required H2 sections → null", () => {
    for (let drop = 0; drop < REQUIRED_H2_SECTIONS.length; drop++) {
      const blocks: ProseMirrorDoc["content"] = [h1("Q?"), p("intro")];
      for (let s = 0; s < REQUIRED_H2_SECTIONS.length; s++) {
        if (s === drop) continue;
        blocks.push(h2(REQUIRED_H2_SECTIONS[s]!));
        blocks.push(p(`section ${s}`));
      }
      expect(extractCardSections({ type: "doc", content: blocks })).toBeNull();
    }
  });

  it("out-of-order H2 sections → null", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...REQUIRED_H2_SECTIONS], {
          minLength: REQUIRED_H2_SECTIONS.length,
          maxLength: REQUIRED_H2_SECTIONS.length,
        }),
        (shuffled) => {
          // Check whether shuffled equals the canonical order; if so, skip
          // (this case is covered by the complete-template branch).
          const isCanonical = shuffled.every((s, i) => s === REQUIRED_H2_SECTIONS[i]);
          fc.pre(!isCanonical);
          const blocks: ProseMirrorDoc["content"] = [h1("Q?"), p("intro")];
          for (const label of shuffled) {
            blocks.push(h2(label));
            blocks.push(p(`s ${label}`));
          }
          expect(extractCardSections({ type: "doc", content: blocks })).toBeNull();
        },
      ),
    );
  });

  it("multiple H1s → null", () => {
    const blocks: ProseMirrorDoc["content"] = [h1("Q?"), h1("Another"), p("..")];
    for (const label of REQUIRED_H2_SECTIONS) {
      blocks.push(h2(label));
      blocks.push(p("..."));
    }
    expect(extractCardSections({ type: "doc", content: blocks })).toBeNull();
  });

  it("missing H1 → null", () => {
    const blocks: ProseMirrorDoc["content"] = [p("starts with paragraph")];
    for (const label of REQUIRED_H2_SECTIONS) {
      blocks.push(h2(label));
      blocks.push(p("..."));
    }
    expect(extractCardSections({ type: "doc", content: blocks })).toBeNull();
  });

  it("unknown H2 label → null", () => {
    const blocks: ProseMirrorDoc["content"] = [h1("Q?")];
    blocks.push(h2(REQUIRED_H2_SECTIONS[0]!));
    blocks.push(p("..."));
    blocks.push(h2("Unknown Label"));
    blocks.push(p("..."));
    blocks.push(h2(REQUIRED_H2_SECTIONS[1]!));
    blocks.push(p("..."));
    blocks.push(h2(REQUIRED_H2_SECTIONS[2]!));
    blocks.push(p("..."));
    blocks.push(h2(REQUIRED_H2_SECTIONS[3]!));
    blocks.push(p("..."));
    expect(extractCardSections({ type: "doc", content: blocks })).toBeNull();
  });

  it("empty content → null", () => {
    expect(extractCardSections({ type: "doc", content: [] })).toBeNull();
  });
});
