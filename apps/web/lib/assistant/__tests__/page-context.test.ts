import { describe, it, expect } from "vitest";

import {
  EMPTY_PAGE_CONTEXT,
  PageContextSchema,
  buildPageContextSection,
} from "../page-context";

describe("PageContextSchema", () => {
  it("accepts a fully-empty object", () => {
    const r = PageContextSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts a partial object with declared fields", () => {
    const r = PageContextSchema.safeParse({
      path: "/studies/abc",
      surveyId: "abc",
      recentSessionIds: ["s1", "s2"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects undeclared fields (strict mode)", () => {
    const r = PageContextSchema.safeParse({ surveyId: "abc", secret: "x" });
    expect(r.success).toBe(false);
  });

  it("caps array sizes", () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `s${i}`);
    const r = PageContextSchema.safeParse({ selectedSegmentIds: tooMany });
    expect(r.success).toBe(false);
  });
});

describe("buildPageContextSection", () => {
  it("returns empty string for empty context", () => {
    expect(buildPageContextSection(EMPTY_PAGE_CONTEXT)).toBe("");
  });

  it("renders only present fields", () => {
    const out = buildPageContextSection({
      path: "/reports/abc",
      surveyId: "abc",
    });
    expect(out).toContain("path: /reports/abc");
    expect(out).toContain("surveyId: abc");
    expect(out).not.toContain("sessionId");
    expect(out).not.toContain("recentSessionIds");
  });

  it("JSON-stringifies array fields", () => {
    const out = buildPageContextSection({ recentSessionIds: ["s1", "s2"] });
    expect(out).toContain('recentSessionIds: ["s1","s2"]');
  });

  it("skips empty arrays", () => {
    const out = buildPageContextSection({ recentSessionIds: [] });
    expect(out).toBe("");
  });
});
