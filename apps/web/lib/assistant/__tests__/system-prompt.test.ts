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

// ============================================================
// buildToolsOverview + manifest path (Wave D T18 / morris-tool-metadata R2 §5)
// ============================================================

import { buildToolsOverview } from "../system-prompt";
import type { ToolMetadata } from "../tool-metadata";

const FIXTURE_MANIFEST: Record<string, ToolMetadata> = {
  alpha: {
    title: "Alpha 工具",
    description:
      "这是 alpha 工具的描述, 应当被 oneLine 取首句。后面的内容不应出现在 overview 段。" +
      "padding 让 description 满足 MIN_DESCRIPTION_CHARS=120 约束。",
    annotations: { readOnly: true, destructive: false, idempotent: true },
    requiredScopes: [],
    type: "read",
    enabled: true,
  },
  beta: {
    title: "Beta 工具",
    description:
      "Beta 工具不启用; 不应出现在 buildToolsOverview 输出中。padding padding " +
      "padding padding padding padding padding padding padding padding 满足长度。",
    annotations: { readOnly: true, destructive: false, idempotent: true },
    requiredScopes: [],
    type: "read",
    enabled: false,
  },
  gamma: {
    title: "Gamma 工具",
    description:
      "Gamma 工具的描述足够长以满足 MIN_DESCRIPTION_CHARS=120 字符的硬阈值。" +
      "首句被取出后用于 overview 行展示, 后续句子被 oneLine 截掉。",
    annotations: { readOnly: false, destructive: false, idempotent: false },
    requiredScopes: ["test:write"],
    type: "write",
    enabled: true,
  },
};

describe("buildToolsOverview — Wave D T18", () => {
  it("only lists enabled tools", () => {
    const out = buildToolsOverview(FIXTURE_MANIFEST);
    expect(out).toContain("alpha");
    expect(out).toContain("gamma");
    expect(out).not.toContain("beta");
  });

  it("uses title and first-sentence of description per line", () => {
    const out = buildToolsOverview(FIXTURE_MANIFEST);
    expect(out).toContain("- alpha: Alpha 工具 — 这是 alpha 工具的描述, 应当被 oneLine 取首句");
    expect(out).toContain("- gamma: Gamma 工具 — Gamma 工具的描述足够长以满足 MIN_DESCRIPTION_CHARS=120 字符的硬阈值");
  });

  it("is byte-level stable for identical manifest input (prompt cache safety)", () => {
    const a = buildToolsOverview(FIXTURE_MANIFEST);
    const b = buildToolsOverview({ ...FIXTURE_MANIFEST });
    expect(a).toBe(b);
  });

  it("changes when manifest description first sentence changes", () => {
    const a = buildToolsOverview(FIXTURE_MANIFEST);
    const b = buildToolsOverview({
      ...FIXTURE_MANIFEST,
      alpha: {
        ...FIXTURE_MANIFEST.alpha,
        description: "改了首句的 alpha 描述。padding padding padding padding padding padding padding padding padding 满足长度。",
      },
    });
    expect(a).not.toBe(b);
    expect(b).toContain("改了首句的 alpha 描述");
  });
});

describe("buildSystemPrompt — manifest integration", () => {
  it("uses static TOOLS_OVERVIEW when manifest is absent (backward compat R9 §1)", () => {
    const out = buildSystemPrompt({});
    // 默认 fallback 应含原静态串里的 listStudies 字样
    expect(out).toContain("listStudies");
    // 不含 fixture 工具
    expect(out).not.toContain("alpha");
  });

  it("uses manifest-derived overview when manifest is provided", () => {
    const out = buildSystemPrompt({ manifest: FIXTURE_MANIFEST });
    expect(out).toContain("- alpha: Alpha 工具");
    expect(out).toContain("- gamma: Gamma 工具");
    // 仅看 <tools_overview> 段, 静态串里的 listStudies/searchInterviewData 等
    // 应被 fixture manifest 替换 (其它段如 ERROR_PROTOCOL 仍可能引用 listStudies 名字)
    const overviewMatch = out.match(/<tools_overview>([\s\S]*?)<\/tools_overview>/);
    expect(overviewMatch).not.toBeNull();
    const overview = overviewMatch![1];
    expect(overview).not.toContain("searchInterviewData");
    expect(overview).not.toContain("listStudies");
    expect(overview).toContain("Alpha 工具");
  });

  it("manifest path keeps tools_overview byte-stable for identical input", () => {
    const a = buildSystemPrompt({ manifest: FIXTURE_MANIFEST });
    const b = buildSystemPrompt({ manifest: FIXTURE_MANIFEST });
    expect(a).toBe(b);
  });
});
