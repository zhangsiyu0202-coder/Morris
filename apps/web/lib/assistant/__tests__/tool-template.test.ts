import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { renderContextPromptTemplate } from "../tool-template";

describe("renderContextPromptTemplate", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("substitutes simple string placeholders", () => {
    const out = renderContextPromptTemplate(
      "page={path} survey={surveyId}",
      { path: "/studies/abc", surveyId: "abc" },
    );
    expect(out).toBe("page=/studies/abc survey=abc");
  });

  it("stringifies booleans and numbers", () => {
    const out = renderContextPromptTemplate("a={a} b={b}", { a: 42, b: false });
    expect(out).toBe("a=42 b=false");
  });

  it("JSON-stringifies arrays and objects", () => {
    const out = renderContextPromptTemplate(
      "ids={ids} obj={obj}",
      { ids: ["a", "b"], obj: { k: 1 } },
    );
    expect(out).toBe('ids=["a","b"] obj={"k":1}');
  });

  it("replaces missing keys with the literal None and warns", () => {
    const out = renderContextPromptTemplate("path={path}", {}, "search");
    expect(out).toBe("path=None");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("treats null/undefined values as None (warn included)", () => {
    const out = renderContextPromptTemplate(
      "p={p} q={q}",
      { p: null, q: undefined },
      "tool",
    );
    expect(out).toBe("p=None q=None");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT touch non-identifier braces", () => {
    const out = renderContextPromptTemplate(
      "fun onEvent(event) { console.log({ a: 1 }) } path={path}",
      { path: "/x" },
    );
    // 内部 { a: 1 } 不会被替换 (`a:`/`a ` 都不是 [A-Za-z_]+ 然后 `}` 紧贴)
    expect(out).toContain("fun onEvent(event)");
    expect(out).toContain("path=/x");
  });

  it("does not expand nested {a.b} patterns", () => {
    const out = renderContextPromptTemplate("v={a.b}", { "a.b": "won't match" });
    // {a.b} 不匹配 PLACEHOLDER_RE (含 `.`), 应原样保留
    expect(out).toBe("v={a.b}");
  });

  it("renders the same key twice consistently", () => {
    const out = renderContextPromptTemplate("{x} and {x}", { x: "yo" });
    expect(out).toBe("yo and yo");
  });
});
