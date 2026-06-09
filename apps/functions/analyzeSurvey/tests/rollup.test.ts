import { describe, it, expect } from "vitest";

import {
  applyThemeSentiments,
  buildGenerationMeta,
  chunkSessionReports,
  enrichSurveyThemes,
  mergeThemeAssignments,
  type ExtractedTheme,
  type ThemeAssignment,
  type ThemeAssignments,
} from "../src/rollup.js";

describe("enrichSurveyThemes", () => {
  const baseThemes: ExtractedTheme[] = [
    { id: "t1", label: "Pricing concern", description: "用户担心价格" },
    { id: "t2", label: "UI confusion", description: "导航不清楚" },
    { id: "t3", label: "Feature gap", description: "缺关键功能" },
  ];

  it("computes mentions/pct from assignments and produces both themes + themeContexts", () => {
    const assignments: ThemeAssignment[] = [
      {
        themeId: "t1",
        sessionIds: ["s1", "s2", "s3"],
        evidenceRefs: [{ transcriptId: "tA", segmentIndex: 0 }],
      },
      {
        themeId: "t2",
        sessionIds: ["s1"],
        evidenceRefs: [{ transcriptId: "tA", segmentIndex: 1 }],
      },
      // t3 没有 assignment → mentions=0, 应被丢弃
    ];
    const out = enrichSurveyThemes(baseThemes, assignments, 5);
    expect(out.themes).toHaveLength(2);
    expect(out.themes.find((t) => t.id === "t1")).toEqual({
      id: "t1",
      label: "Pricing concern",
      mentions: 3,
      pct: 60,
    });
    expect(out.themes.find((t) => t.id === "t2")).toEqual({
      id: "t2",
      label: "UI confusion",
      mentions: 1,
      pct: 20,
    });
    expect(out.themes.find((t) => t.id === "t3")).toBeUndefined(); // mentions=0 dropped

    expect(out.themeContexts).toHaveLength(2);
    expect(out.themeContexts.find((c) => c.id === "t1")).toEqual({
      id: "t1",
      label: "Pricing concern",
      description: "用户担心价格",
      evidenceRefs: [{ transcriptId: "tA", segmentIndex: 0 }],
    });
  });

  it("returns empty arrays when no assignment matches", () => {
    const out = enrichSurveyThemes(baseThemes, [], 5);
    expect(out.themes).toEqual([]);
    expect(out.themeContexts).toEqual([]);
  });

  it("handles totalSessions = 0 without divide-by-zero", () => {
    const out = enrichSurveyThemes(
      baseThemes,
      [
        {
          themeId: "t1",
          sessionIds: ["s1"],
          evidenceRefs: [],
        },
      ],
      0,
    );
    // mentions=1, pct=0 (because totalSessions=0)
    expect(out.themes[0].mentions).toBe(1);
    expect(out.themes[0].pct).toBe(0);
  });

  it("normalizes shares when sum > 1.0 (P-ANL-04 guard)", () => {
    // 3 themes 各 80%/60%/40% → sum=1.8 > 1.0,需要 normalize
    const assignments: ThemeAssignment[] = [
      { themeId: "t1", sessionIds: ["s1", "s2", "s3", "s4"], evidenceRefs: [] }, // 80%
      { themeId: "t2", sessionIds: ["s1", "s2", "s3"], evidenceRefs: [] }, // 60%
      { themeId: "t3", sessionIds: ["s1", "s2"], evidenceRefs: [] }, // 40%
    ];
    const out = enrichSurveyThemes(baseThemes, assignments, 5);
    const totalShare = out.themes.reduce((s, t) => s + t.pct / 100, 0);
    expect(totalShare).toBeLessThanOrEqual(1.0 + 1e-2); // 允许小数精度
    // mentions 大的 theme 应该 pct 也大 (normalize 后保序)
    const t1 = out.themes.find((t) => t.id === "t1")!;
    const t2 = out.themes.find((t) => t.id === "t2")!;
    const t3 = out.themes.find((t) => t.id === "t3")!;
    expect(t1.pct).toBeGreaterThan(t2.pct);
    expect(t2.pct).toBeGreaterThan(t3.pct);
  });

  it("themes 落库形态绝不含 description / evidenceRefs (C1 修订)", () => {
    const out = enrichSurveyThemes(
      [baseThemes[0]],
      [{ themeId: "t1", sessionIds: ["s1"], evidenceRefs: [] }],
      1,
    );
    const t = out.themes[0];
    expect(t).not.toHaveProperty("description");
    expect(t).not.toHaveProperty("evidenceRefs");
    expect(Object.keys(t).sort()).toEqual(["id", "label", "mentions", "pct"]);
  });
});

describe("applyThemeSentiments", () => {
  it("merges sentiments by themeId", () => {
    const themesPre = [
      { id: "t1", label: "x", mentions: 3, pct: 60 },
      { id: "t2", label: "y", mentions: 1, pct: 20 },
    ];
    const out = applyThemeSentiments(themesPre, { t1: "positive", t2: "negative" });
    expect(out[0].sentiment).toBe("positive");
    expect(out[1].sentiment).toBe("negative");
  });

  it("defaults to 'neutral' when sentiment missing", () => {
    const themesPre = [{ id: "t1", label: "x", mentions: 1, pct: 50 }];
    const out = applyThemeSentiments(themesPre, {});
    expect(out[0].sentiment).toBe("neutral");
  });
});

describe("buildGenerationMeta", () => {
  it("creates createdWith with three stages", () => {
    const m = buildGenerationMeta({
      promptVersion: "survey.v2.0",
      attemptCount: 1,
      hallucinationRatio: 0,
      models: { extract: "deepseek-chat", assign: "deepseek-chat", compose: "deepseek-chat" },
    });
    expect(m.promptVersion).toBe("survey.v2.0");
    expect(m.attemptCount).toBe(1);
    expect(m.hallucinationRatio).toBe(0);
    expect(m.createdWith.map((c) => c.stage)).toEqual(["extract", "assign", "compose"]);
  });
});

// =============================================================
// Wave F (D15): chunkSessionReports + mergeThemeAssignments
// =============================================================

describe("chunkSessionReports", () => {
  it("空数组 → []", () => {
    expect(chunkSessionReports([], 10)).toEqual([]);
  });

  it("size > length → 单 chunk 含全部", () => {
    expect(chunkSessionReports([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("size === length → 单 chunk", () => {
    expect(chunkSessionReports([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("size < length → 多 chunk, 最后一 chunk 可不满", () => {
    expect(chunkSessionReports([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("concat ∘ chunkSessionReports = id (P-ANL-08 性质)", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const flat = chunkSessionReports(items, 5).flat();
    expect(flat).toEqual(items);
  });

  it("size <= 0 抛错", () => {
    expect(() => chunkSessionReports([1, 2], 0)).toThrow(/positive/);
    expect(() => chunkSessionReports([1, 2], -1)).toThrow(/positive/);
  });
});

describe("mergeThemeAssignments", () => {
  const a: ThemeAssignments = {
    assignments: [
      {
        themeId: "t1",
        sessionIds: ["s1", "s2"],
        evidenceRefs: [{ transcriptId: "tx1", segmentIndex: 0 }],
      },
    ],
  };
  const b: ThemeAssignments = {
    assignments: [
      {
        themeId: "t1",
        sessionIds: ["s2", "s3"], // s2 与 a 重叠
        evidenceRefs: [
          { transcriptId: "tx1", segmentIndex: 0 }, // 与 a 重叠
          { transcriptId: "tx2", segmentIndex: 5 },
        ],
      },
      {
        themeId: "t2",
        sessionIds: ["s4"],
        evidenceRefs: [],
      },
    ],
  };

  it("空列表 → 空 assignments", () => {
    expect(mergeThemeAssignments([])).toEqual({ assignments: [] });
  });

  it("单份透传 (themeId / sessionIds / evidenceRefs 完整保留)", () => {
    const out = mergeThemeAssignments([a]);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0].themeId).toBe("t1");
    expect(out.assignments[0].sessionIds.sort()).toEqual(["s1", "s2"]);
    expect(out.assignments[0].evidenceRefs).toHaveLength(1);
  });

  it("两份合并: 同 themeId 的 sessionIds dedupe + evidenceRefs dedupe", () => {
    const out = mergeThemeAssignments([a, b]);
    expect(out.assignments).toHaveLength(2);
    const t1 = out.assignments.find((x) => x.themeId === "t1")!;
    expect(t1.sessionIds.sort()).toEqual(["s1", "s2", "s3"]); // s2 dedupe
    expect(t1.evidenceRefs).toHaveLength(2); // tx1#0 dedupe, tx2#5 加进来
    const t2 = out.assignments.find((x) => x.themeId === "t2")!;
    expect(t2.sessionIds).toEqual(["s4"]);
  });

  it("结合律: merge(merge(a,b), c) ≡ merge(a, merge(b,c))  (字段集层面)", () => {
    const c: ThemeAssignments = {
      assignments: [
        { themeId: "t1", sessionIds: ["s5"], evidenceRefs: [] },
        { themeId: "t3", sessionIds: ["s6"], evidenceRefs: [] },
      ],
    };
    const left = mergeThemeAssignments([mergeThemeAssignments([a, b]), c]);
    const right = mergeThemeAssignments([a, mergeThemeAssignments([b, c])]);
    // 比较字段集 (themeId → 排序 sessionIds 集) 而非顺序
    const toMap = (x: ThemeAssignments) =>
      Object.fromEntries(
        x.assignments.map((a) => [a.themeId, a.sessionIds.slice().sort()]),
      );
    expect(toMap(left)).toEqual(toMap(right));
  });

  it("交换律字段层: merge(a,b) 与 merge(b,a) 在 (themeId → sessionIds 集) 完全等价", () => {
    const ab = mergeThemeAssignments([a, b]);
    const ba = mergeThemeAssignments([b, a]);
    const toMap = (x: ThemeAssignments) =>
      Object.fromEntries(
        x.assignments.map((a) => [a.themeId, a.sessionIds.slice().sort()]),
      );
    expect(toMap(ab)).toEqual(toMap(ba));
  });

  it("同一 (themeId, sessionId) 不重计 → 保护 P-ANL-07 mentions 精确性", () => {
    const dupA: ThemeAssignments = {
      assignments: [{ themeId: "t1", sessionIds: ["s1"], evidenceRefs: [] }],
    };
    const dupB: ThemeAssignments = {
      assignments: [{ themeId: "t1", sessionIds: ["s1"], evidenceRefs: [] }],
    };
    const out = mergeThemeAssignments([dupA, dupB]);
    expect(out.assignments[0].sessionIds).toEqual(["s1"]); // 不重复
  });
});
