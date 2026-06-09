import { describe, it, expect } from "vitest";

import {
  AGENT_INFO,
  buildSystemPrompt,
  ERROR_PROTOCOL,
  renderToolContexts,
  STYLE,
  TOOLS_OVERVIEW,
  WORKSTYLE,
} from "../system-prompt";

const STATIC_PREFIX_BYTES = [
  `<agent_info>\n${AGENT_INFO}\n</agent_info>`,
  `<tools_overview>\n${TOOLS_OVERVIEW}\n</tools_overview>`,
  `<workstyle>\n${WORKSTYLE}\n</workstyle>`,
  `<style>\n${STYLE}\n</style>`,
  `<error_protocol>\n${ERROR_PROTOCOL}\n</error_protocol>`,
].join("\n\n");

describe("buildSystemPrompt", () => {
  it("starts with the canonical static prefix (byte-stable)", () => {
    const out = buildSystemPrompt();
    expect(out.startsWith(STATIC_PREFIX_BYTES)).toBe(true);
  });

  it("omits all dynamic sections when there is no todo / pageContext / toolContexts", () => {
    const out = buildSystemPrompt();
    expect(out).not.toContain("<current_todo>");
    expect(out).not.toContain("<page_context>");
    expect(out).not.toContain("<tool_context>");
    // prompt cache friendly: no random/timestamp drift
    expect(buildSystemPrompt()).toBe(out);
  });

  it("renders <current_todo> only when todos is non-empty", () => {
    const out = buildSystemPrompt({
      todos: [{ id: "t1", title: "调研 A 的洞察", status: "in_progress" }],
    });
    expect(out).toContain("<current_todo>");
    expect(out).toContain("- [in_progress] 调研 A 的洞察");
  });

  it("renders <page_context> with key=value lines, skipping empty arrays", () => {
    const out = buildSystemPrompt({
      pageContext: {
        path: "/studies/abc/guide",
        surveyId: "abc",
        recentSessionIds: [],
      },
    });
    expect(out).toContain("<page_context>");
    expect(out).toContain("path: /studies/abc/guide");
    expect(out).toContain("surveyId: abc");
    expect(out).not.toContain("recentSessionIds");
  });

  it("renders <tool_context> only for non-empty rendered entries", () => {
    const out = buildSystemPrompt({
      toolContexts: [
        { toolName: "searchInterviewData", rendered: "当前页面: /x. 主调研: y." },
        { toolName: "createStudyDraft", rendered: "" }, // 应被过滤
      ],
    });
    expect(out).toContain('<tool name="searchInterviewData">');
    expect(out).not.toContain('<tool name="createStudyDraft">');
  });

  it("places dynamic sections strictly after static sections", () => {
    const out = buildSystemPrompt({
      todos: [{ id: "t1", title: "x", status: "pending" }],
      pageContext: { path: "/p" },
      toolContexts: [{ toolName: "search", rendered: "ctx" }],
    });
    const idxStaticEnd = out.indexOf("</error_protocol>");
    const idxTodo = out.indexOf("<current_todo>");
    const idxPage = out.indexOf("<page_context>");
    const idxTool = out.indexOf("<tool_context>");
    expect(idxStaticEnd).toBeGreaterThan(0);
    expect(idxTodo).toBeGreaterThan(idxStaticEnd);
    expect(idxPage).toBeGreaterThan(idxStaticEnd);
    expect(idxTool).toBeGreaterThan(idxStaticEnd);
  });
});

describe("renderToolContexts", () => {
  it("filters out tools with no template", () => {
    const out = renderToolContexts(
      { surveyId: "abc" },
      { search: "survey={surveyId}", listStudies: undefined },
    );
    expect(out).toHaveLength(1);
    expect(out[0].toolName).toBe("search");
    expect(out[0].rendered).toBe("survey=abc");
  });

  it("filters out tools whose render result is whitespace-only", () => {
    const out = renderToolContexts({}, { search: "   " });
    expect(out).toHaveLength(0);
  });

  it("keeps the order of input templates", () => {
    const out = renderToolContexts(
      { surveyId: "x" },
      { a: "a={surveyId}", b: "b={surveyId}", c: "c={surveyId}" },
    );
    expect(out.map((e) => e.toolName)).toEqual(["a", "b", "c"]);
  });
});
