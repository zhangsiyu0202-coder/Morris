import { describe, it, expect } from "vitest";
import { extractCardSections, REQUIRED_H2_SECTIONS } from "../heading-template";
import type { ProseMirrorDoc } from "../types";

function h1(text: string): ProseMirrorDoc["content"][number] {
  return { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] };
}
function h2(text: string): ProseMirrorDoc["content"][number] {
  return { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] };
}
function p(text: string): ProseMirrorDoc["content"][number] {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const FULL_TEMPLATE: ProseMirrorDoc = {
  type: "doc",
  content: [
    h1("受访者怎么看定价?"),
    p("72% 把价格列为放弃首要原因。"),
    h2("核心结论"),
    p("价格敏感度高于预期。"),
    h2("主题分析"),
    p("分维度展开..."),
    h2("立场分歧"),
    p("分歧立场..."),
    h2("行动建议"),
    p("P0 调整定价..."),
  ],
};

describe("notebooks: extractCardSections", () => {
  it("returns CardSections for a complete 5-section template", () => {
    const out = extractCardSections(FULL_TEMPLATE);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.question).toBe("受访者怎么看定价?");
    expect(out.intro).toHaveLength(1);
    for (const label of REQUIRED_H2_SECTIONS) {
      expect(out.sections[label]).toHaveLength(1);
    }
  });

  it("returns null when missing one H2 section", () => {
    const partial: ProseMirrorDoc = {
      type: "doc",
      content: [
        h1("Q?"),
        p("intro"),
        h2("核心结论"),
        p("..."),
        h2("主题分析"),
        p("..."),
        // missing 立场分歧
        h2("行动建议"),
        p("..."),
      ],
    };
    expect(extractCardSections(partial)).toBeNull();
  });

  it("returns null when H2 sections are out of order", () => {
    const wrong: ProseMirrorDoc = {
      type: "doc",
      content: [
        h1("Q?"),
        h2("主题分析"), // should be 核心结论 first
        p("..."),
        h2("核心结论"),
        p("..."),
        h2("立场分歧"),
        p("..."),
        h2("行动建议"),
        p("..."),
      ],
    };
    expect(extractCardSections(wrong)).toBeNull();
  });

  it("returns null when there are multiple H1s", () => {
    const multiH1: ProseMirrorDoc = {
      type: "doc",
      content: [
        h1("Q?"),
        h1("Another H1"),
        h2("核心结论"),
        p("..."),
        h2("主题分析"),
        p("..."),
        h2("立场分歧"),
        p("..."),
        h2("行动建议"),
        p("..."),
      ],
    };
    expect(extractCardSections(multiH1)).toBeNull();
  });

  it("returns null when H1 is missing (first block is paragraph)", () => {
    const noH1: ProseMirrorDoc = {
      type: "doc",
      content: [p("starts with paragraph"), h2("核心结论"), p("...")],
    };
    expect(extractCardSections(noH1)).toBeNull();
  });

  it("returns null when an unknown H2 label appears in template", () => {
    const unknown: ProseMirrorDoc = {
      type: "doc",
      content: [
        h1("Q?"),
        h2("核心结论"),
        p("..."),
        h2("Unknown Section"), // not in REQUIRED_H2_SECTIONS
        p("..."),
        h2("主题分析"),
        p("..."),
        h2("立场分歧"),
        p("..."),
        h2("行动建议"),
        p("..."),
      ],
    };
    expect(extractCardSections(unknown)).toBeNull();
  });

  it("empty content / null doc → null", () => {
    expect(extractCardSections({ type: "doc", content: [] })).toBeNull();
  });
});
