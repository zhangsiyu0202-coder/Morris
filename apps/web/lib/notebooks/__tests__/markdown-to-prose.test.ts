import { describe, it, expect } from "vitest";
import {
  markdownToProseMirror,
  hasUnclosedMerismTag,
} from "../markdown-to-prose";
import { EMPTY_DOC, MERISM_NODE_TYPES } from "../types";

describe("notebooks: markdownToProseMirror", () => {
  it("empty string returns empty doc", () => {
    expect(markdownToProseMirror("")).toEqual(EMPTY_DOC);
  });

  it("plain Markdown without tags: heading + paragraph", () => {
    const md = `# Title\n\nThis is a paragraph.`;
    const doc = markdownToProseMirror(md);
    expect(doc.content).toEqual([
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "This is a paragraph." }],
      },
    ]);
  });

  it("supports H1/H2/H3", () => {
    const md = `# A\n\n## B\n\n### C\n\nbody`;
    const doc = markdownToProseMirror(md);
    expect(doc.content.map((b) => b.type === "heading" && b.attrs.level)).toEqual([
      1,
      2,
      3,
      false, // body paragraph
    ]);
  });

  it("merges multi-line paragraph into single paragraph (line breaks → spaces)", () => {
    const md = `Hello\nworld\nthis is one paragraph.`;
    const doc = markdownToProseMirror(md);
    expect(doc.content).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello world this is one paragraph." }],
      },
    ]);
  });

  describe("8 类 merism-* atom node 各一个 case", () => {
    const cases: Array<{ tag: string; type: string; check: Record<string, unknown> }> = [
      {
        tag: `<merism-quote sessionId="s1" segmentIndex="5" quote="hello" />`,
        type: "merism-quote",
        check: { sessionId: "s1", segmentIndex: 5, quote: "hello" },
      },
      {
        tag: `<merism-video-clip sessionId="s2" startMs="14000" endMs="20000" />`,
        type: "merism-video-clip",
        check: { sessionId: "s2", startMs: 14000, endMs: 20000 },
      },
      {
        tag: `<merism-theme themeId="pricing" mentions="18" pct="60" />`,
        type: "merism-theme",
        check: { themeId: "pricing", mentions: 18, pct: 60 },
      },
      {
        tag: `<merism-video-observation sessionId="s3" startMs="35000" note="frown" />`,
        type: "merism-video-observation",
        check: { sessionId: "s3", startMs: 35000, note: "frown" },
      },
      {
        tag: `<merism-insight-link notebookShortId="abc123def456" />`,
        type: "merism-insight-link",
        check: { notebookShortId: "abc123def456" },
      },
      {
        tag: `<merism-question-stat questionId="q1" mentions="42" />`,
        type: "merism-question-stat",
        check: { questionId: "q1", mentions: 42 },
      },
      {
        tag: `<merism-cross-study-citation sourceNotebookShortId="xyz789ghi012" headline="Past finding" />`,
        type: "merism-cross-study-citation",
        check: { sourceNotebookShortId: "xyz789ghi012", headline: "Past finding" },
      },
      {
        tag: `<merism-session-link sessionId="s4" label="Interview 4" />`,
        type: "merism-session-link",
        check: { sessionId: "s4", label: "Interview 4" },
      },
    ];

    for (const c of cases) {
      it(`parses ${c.type}`, () => {
        const doc = markdownToProseMirror(`Embed: ${c.tag} done.`);
        const para = doc.content[0];
        expect(para?.type).toBe("paragraph");
        if (para?.type !== "paragraph") return;
        const merism = para.content.find((n) => n.type === c.type);
        expect(merism).toBeDefined();
        expect(merism!.type).toBe(c.type);
        if (merism && "attrs" in merism) {
          const attrs = merism.attrs as Record<string, unknown>;
          for (const [k, v] of Object.entries(c.check)) {
            expect(attrs[k]).toBe(v);
          }
        }
      });
    }

    it("8 测试上面覆盖了完整 8 类 merism-* type", () => {
      expect(cases.map((c) => c.type).sort()).toEqual([...MERISM_NODE_TYPES].sort());
    });
  });

  describe("未闭合 tag fallback (B3 流式半截 tag)", () => {
    it("trailing unclosed `<merism-quote sessionId=\"abc\"` is rendered as plain text, no throw", () => {
      const md = `Pre-text <merism-quote sessionId="abc"`;
      const doc = markdownToProseMirror(md);
      expect(doc.content).toHaveLength(1);
      const para = doc.content[0];
      if (para?.type !== "paragraph") throw new Error("expected paragraph");
      // Should have a single text node containing the unclosed prefix
      expect(para.content).toHaveLength(1);
      expect(para.content[0]).toEqual({
        type: "text",
        text: `Pre-text <merism-quote sessionId="abc"`,
      });
    });

    it("complete tag arriving later parses correctly (re-render flow)", () => {
      const halfway = `Pre-text <merism-quote sessionId="abc"`;
      const finished = `Pre-text <merism-quote sessionId="abc" segmentIndex="3" />`;
      const doc1 = markdownToProseMirror(halfway);
      const doc2 = markdownToProseMirror(finished);
      // halfway: just plain text
      expect(doc1.content[0]?.type).toBe("paragraph");
      // finished: parsed as quote node + surrounding text
      const para = doc2.content[0];
      if (para?.type !== "paragraph") throw new Error("expected paragraph");
      const types = para.content.map((n) => n.type);
      expect(types).toContain("merism-quote");
    });

    it("hasUnclosedMerismTag detects half-tag", () => {
      expect(hasUnclosedMerismTag(`<merism-`)).toBe(true);
      expect(hasUnclosedMerismTag(`Pre <merism-quote sessionId="abc"`)).toBe(true);
      expect(hasUnclosedMerismTag(`<merism-quote />`)).toBe(false);
      expect(hasUnclosedMerismTag(`No tag at all`)).toBe(false);
    });
  });

  describe("边界 case", () => {
    it("plain Markdown with no tags renders as paragraphs", () => {
      const md = `Para 1.\n\nPara 2.`;
      const doc = markdownToProseMirror(md);
      expect(doc.content.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    });

    it("unknown <merism-foo /> tag gets preserved as plain text", () => {
      const md = `Hello <merism-foo bar="baz" /> world`;
      const doc = markdownToProseMirror(md);
      const para = doc.content[0];
      if (para?.type !== "paragraph") throw new Error("expected paragraph");
      // Single concatenated text node containing the unknown tag verbatim
      expect(para.content).toHaveLength(1);
      const t = para.content[0];
      expect(t?.type).toBe("text");
      if (t?.type === "text") {
        expect(t.text).toContain("<merism-foo");
        expect(t.text).toContain("Hello");
        expect(t.text).toContain("world");
      }
    });

    it("malformed tag attributes don't crash (graceful coerce)", () => {
      const md = `<merism-quote sessionId= broken =vals quote="ok" />`;
      const doc = markdownToProseMirror(md);
      // shouldn't throw; just gives some node with attrs we managed to scrape
      expect(doc.content[0]?.type).toBe("paragraph");
    });

    it("multi-paragraph with embedded tags", () => {
      const md =
        `# Findings\n\n` +
        `First, see <merism-quote sessionId="s1" segmentIndex="2" quote="x" />.\n\n` +
        `Second observation.`;
      const doc = markdownToProseMirror(md);
      expect(doc.content.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
    });
  });
});
