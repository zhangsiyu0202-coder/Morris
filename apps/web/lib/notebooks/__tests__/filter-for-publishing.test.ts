import { describe, it, expect } from "vitest";
import {
  filterNotebookContentForPublishing,
  PUBLISHED_ALLOWLIST,
} from "../filter-for-publishing";
import type { ProseMirrorDoc } from "../types";

const SAMPLE: ProseMirrorDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Q?" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "支撑: " },
        // allowlisted
        {
          type: "merism-quote",
          attrs: { sessionId: "s1", segmentIndex: 5, quote: "abc" },
        },
        { type: "text", text: " 主题: " },
        // allowlisted
        { type: "merism-theme", attrs: { themeId: "pricing", mentions: 18 } },
        { type: "text", text: " 视频: " },
        // NOT allowlisted (PII)
        {
          type: "merism-video-clip",
          attrs: { sessionId: "s1", startMs: 14000, endMs: 20000 },
        },
        { type: "text", text: " 引用: " },
        // NOT allowlisted (内部 notebook 链接)
        { type: "merism-insight-link", attrs: { notebookShortId: "abc123def456" } },
        { type: "text", text: " 跨 study: " },
        // allowlisted (only headline + shortId, target notebook still internal)
        {
          type: "merism-cross-study-citation",
          attrs: { sourceNotebookShortId: "x1", headline: "Past finding" },
        },
        { type: "text", text: " 会话: " },
        // NOT allowlisted (sessionId 直接暴露)
        { type: "merism-session-link", attrs: { sessionId: "s1", label: "Sess 1" } },
      ],
    },
  ],
};

describe("notebooks: filterNotebookContentForPublishing", () => {
  it("preserves text + allow-listed atom nodes (default allowlist)", () => {
    const out = filterNotebookContentForPublishing(SAMPLE);
    const para = out.content[1];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    const merismTypes = para.content
      .filter((n) => n.type !== "text")
      .map((n) => n.type);
    // Allow-listed kept verbatim, others replaced with merism-stripped
    expect(merismTypes).toEqual([
      "merism-quote",
      "merism-theme",
      "merism-stripped", // was merism-video-clip
      "merism-stripped", // was merism-insight-link
      "merism-cross-study-citation",
      "merism-stripped", // was merism-session-link
    ]);
  });

  it("stripped nodes carry only `kind` attr (no PII attrs)", () => {
    const out = filterNotebookContentForPublishing(SAMPLE);
    const para = out.content[1];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    for (const n of para.content) {
      if (n.type === "merism-stripped") {
        const keys = Object.keys((n as { attrs: Record<string, unknown> }).attrs);
        expect(keys).toEqual(["kind"]);
        // Common forbidden attrs absent
        const attrs = (n as { attrs: Record<string, unknown> }).attrs;
        expect(attrs).not.toHaveProperty("sessionId");
        expect(attrs).not.toHaveProperty("startMs");
        expect(attrs).not.toHaveProperty("endMs");
        expect(attrs).not.toHaveProperty("notebookShortId");
      }
    }
  });

  it("paragraph + heading + text are unchanged in shape", () => {
    const out = filterNotebookContentForPublishing(SAMPLE);
    expect(out.content[0]).toEqual(SAMPLE.content[0]); // heading unchanged
  });

  it("idempotent — filter(filter(doc)) === filter(doc) (P-NB-03 部分性质)", () => {
    const once = filterNotebookContentForPublishing(SAMPLE);
    const twice = filterNotebookContentForPublishing(once);
    expect(twice).toEqual(once);
  });

  it("custom allowlist {merism-quote only}: only quote kept, theme/citation also stripped", () => {
    const out = filterNotebookContentForPublishing(SAMPLE, ["merism-quote"]);
    const para = out.content[1];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    const merismTypes = para.content
      .filter((n) => n.type !== "text")
      .map((n) => n.type);
    expect(merismTypes).toEqual([
      "merism-quote",
      "merism-stripped", // theme
      "merism-stripped", // video-clip
      "merism-stripped", // insight-link
      "merism-stripped", // cross-study-citation
      "merism-stripped", // session-link
    ]);
  });

  it("empty / null doc → safe empty result", () => {
    expect(filterNotebookContentForPublishing({ type: "doc", content: [] })).toEqual({
      type: "doc",
      content: [],
    });
  });

  it("default allowlist contains exactly the 4 expected types", () => {
    expect([...PUBLISHED_ALLOWLIST].sort()).toEqual([
      "merism-cross-study-citation",
      "merism-question-stat",
      "merism-quote",
      "merism-theme",
    ]);
  });
});
