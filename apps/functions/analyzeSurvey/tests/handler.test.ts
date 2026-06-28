import { describe, it, expect, vi } from "vitest";
import {
  analyzeSurvey,
  type AnalyzeSurveyDeps,
  type SessionDigest,
  type SessionLevelReport,
  type SurveyContextLite,
} from "../src/handler";
import type {
  ComposeInsightsOutput,
  ExtractedThemes,
  ThemeAssignments,
} from "../src/rollup";

const baseSurvey: SurveyContextLite = {
  surveyId: "sv1",
  ownerUserId: "user-owner",
  title: "Test Study",
  questionBlocks: [
    {
      questionId: "q1",
      type: "single_choice",
      prompt: "Pick one",
      config: { options: ["A", "B"] },
    },
  ],
  topics: ["fallback topic"],
};

const baseSessions: SessionDigest[] = [
  {
    sessionId: "sess1",
    transcriptId: "sess1",
    state: "completed",
    answers: [
      { sessionId: "sess1", questionId: "q1", questionType: "single_choice", selectedOptions: ["A"] },
    ],
  },
  {
    sessionId: "sess2",
    transcriptId: "sess2",
    state: "completed",
    answers: [
      { sessionId: "sess2", questionId: "q1", questionType: "single_choice", selectedOptions: ["B"] },
    ],
  },
];

const baseSessionReports: SessionLevelReport[] = [
  {
    reportId: "ar-1",
    sessionId: "sess1",
    themes: [],
    insights: [],
    citations: [],
    perQuestionSummary: [],
  },
  {
    reportId: "ar-2",
    sessionId: "sess2",
    themes: [],
    insights: [],
    citations: [],
    perQuestionSummary: [],
  },
];

const baseExtracted: ExtractedThemes = {
  themes: [
    { id: "t1", label: "Choice quality", description: "用户认为选项质量高" },
    { id: "t2", label: "Pricing", description: "用户对价格敏感" },
  ],
};

const baseAssignments: ThemeAssignments = {
  assignments: [
    { themeId: "t1", sessionIds: ["sess1", "sess2"], evidenceRefs: [] },
    { themeId: "t2", sessionIds: ["sess1"], evidenceRefs: [] },
  ],
};

const baseCompose: ComposeInsightsOutput = {
  insights: [{ id: "i1", title: "Top driver", text: "Choice", confidence: 0.7 }],
  citations: [],
  topics: ["LLM topic"],
  sentimentBreakdown: [
    { sentiment: "positive", count: 1 },
    { sentiment: "neutral", count: 1 },
    { sentiment: "negative", count: 0 },
  ],
  themeSentiments: { t1: "positive", t2: "negative" },
  questionSummaries: { q1: "Even split between A and B." },
};

interface Overrides {
  survey?: SurveyContextLite | null;
  sessions?: SessionDigest[];
  reports?: SessionLevelReport[];
  extract?: (input?: any) => Promise<ExtractedThemes>;
  assign?: (input?: any) => Promise<ThemeAssignments>;
  combine?: (input: any) => Promise<ExtractedThemes>;
  compose?: any;
  upsert?: (args: any) => Promise<{ reportId: string }>;
}

function makeDeps(overrides: Overrides = {}): AnalyzeSurveyDeps & {
  upsertSpy: ReturnType<typeof vi.fn>;
  extractSpy: ReturnType<typeof vi.fn>;
  assignSpy: ReturnType<typeof vi.fn>;
  composeSpy: ReturnType<typeof vi.fn>;
  combineSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn(overrides.upsert ?? (async () => ({ reportId: "ar-survey" })));
  const extractSpy = vi.fn(overrides.extract ?? (async () => baseExtracted));
  const assignSpy = vi.fn(overrides.assign ?? (async () => baseAssignments));
  const composeSpy = vi.fn(overrides.compose ?? (async () => baseCompose));
  // Wave F: combine 默认 spy — N≤THRESHOLD 走单 chunk 路径时不会被调用,
  // 默认实现取第一份 raw themes 透传。
  const combineSpy = vi.fn(
    overrides.combine ??
      (async (input: any) => input.rawThemesList[0] ?? baseExtracted),
  );
  return {
    now: () => Date.UTC(2026, 5, 6, 0, 0, 0),
    findSurveyContext: async () =>
      ("survey" in overrides ? overrides.survey : baseSurvey) as SurveyContextLite | null,
    findCompletedSessions: async () => overrides.sessions ?? baseSessions,
    findSessionReports: async () => overrides.reports ?? baseSessionReports,
    extractThemesWithLLM: extractSpy,
    assignThemesWithLLM: assignSpy,
    combineThemesWithLLM: combineSpy,
    composeInsightsWithLLM: composeSpy,
    upsertSurveyReport: upsertSpy,
    upsertSpy,
    extractSpy,
    assignSpy,
    composeSpy,
    combineSpy,
  } as any;
}

describe("analyzeSurvey handler", () => {
  it("rejects invalid input with 400", async () => {
    const deps = makeDeps();
    const result = await analyzeSurvey({}, deps);
    expect(result.status).toBe(400);
  });

  it("returns 404 when survey not found", async () => {
    const deps = makeDeps({ survey: null });
    const result = await analyzeSurvey({ surveyId: "missing" }, deps);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "survey_not_found" });
    expect(deps.extractSpy).not.toHaveBeenCalled();
  });

  it("returns 409 when no sessions are completed", async () => {
    const deps = makeDeps({ sessions: [] });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "no_completed_sessions" });
    expect(deps.extractSpy).not.toHaveBeenCalled();
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when extract LLM throws", async () => {
    const deps = makeDeps({
      extract: async () => {
        throw new Error("upstream");
      },
    });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(500);
    // P-SEC-04: body is exactly { error: <code> } — guards against future
    // catch handlers that would append err.message into the body.
    expect(result.body).toEqual({ error: "llm_unavailable" });
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when assign LLM throws", async () => {
    const deps = makeDeps({
      assign: async () => {
        throw new Error("upstream");
      },
    });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(500);
    // P-SEC-04: body is exactly { error: <code> }.
    expect(result.body).toEqual({ error: "llm_unavailable" });
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when compose LLM throws", async () => {
    const deps = makeDeps({
      compose: async () => {
        throw new Error("upstream");
      },
    });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(500);
    // P-SEC-04: body is exactly { error: <code> }.
    expect(result.body).toEqual({ error: "llm_unavailable" });
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when persistence throws", async () => {
    const deps = makeDeps({
      upsert: async () => {
        throw new Error("appwrite down");
      },
    });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(500);
    // P-SEC-04: body is exactly { error: <code> }.
    expect(result.body).toEqual({ error: "persist_failed" });
  });

  it("happy path: 200, completedRespondents matches session count, summaries merged", async () => {
    const deps = makeDeps();
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reportId: "ar-survey", scope: "survey" });
    const upsertCall = deps.upsertSpy.mock.calls[0][0];
    expect(upsertCall.body.completedRespondents).toBe(2);
    expect(upsertCall.body.questionStats[0].summary).toBe("Even split between A and B.");
    expect(upsertCall.body.topics).toEqual(["LLM topic"]);
  });

  it("clamps theme share to <= 100 (P-ANL-04, normalized in enrichSurveyThemes)", async () => {
    // 让 assign 把同 2 个 session 都归到两个不同 theme,各算 100%, sum=200% > 100%
    // → enrichSurveyThemes 做 share normalize。
    const deps = makeDeps({
      assign: async () => ({
        assignments: [
          { themeId: "t1", sessionIds: ["sess1", "sess2"], evidenceRefs: [] },
          { themeId: "t2", sessionIds: ["sess1", "sess2"], evidenceRefs: [] },
        ],
      }),
    });
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    const stored = deps.upsertSpy.mock.calls[0][0].body.themes;
    const sum = stored.reduce((acc: number, t: any) => acc + t.pct, 0);
    expect(sum).toBeLessThanOrEqual(100.1);
  });

  it("falls back to survey topics when compose LLM returns empty topics", async () => {
    const deps = makeDeps({
      compose: async () => ({ ...baseCompose, topics: [] }),
    });
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    const stored = deps.upsertSpy.mock.calls[0][0].body.topics;
    expect(stored).toEqual(["fallback topic"]);
  });

  it("idempotent: same surveyId resolves to same upsert keys", async () => {
    const calls: any[] = [];
    const deps = makeDeps({
      upsert: async (args) => {
        calls.push(args);
        return { reportId: "ar-stable" };
      },
    });
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(calls).toHaveLength(2);
    expect(calls[0].surveyId).toBe(calls[1].surveyId);
    expect(calls[0].ownerUserId).toBe(calls[1].ownerUserId);
  });
});

// =============================================================================
// analysis-report-v2 专项测试 (T24)
// 覆盖 R2 generationMeta + R3 hallucination 校验 + 三阶段 mock
// =============================================================================

describe("analyzeSurvey v2: hallucination + generationMeta", () => {
  it("happy path: 200 + generationMeta 含三阶段 createdWith + ratio=0", async () => {
    const deps = makeDeps();
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(200);
    expect(deps.extractSpy).toHaveBeenCalledOnce();
    expect(deps.assignSpy).toHaveBeenCalledOnce();
    expect(deps.composeSpy).toHaveBeenCalledOnce();
    const args = deps.upsertSpy.mock.calls[0][0];
    expect(args.generationMeta).toMatchObject({
      promptVersion: "survey.v2.0",
      attemptCount: 1,
      hallucinationRatio: 0,
    });
    expect(args.generationMeta.createdWith.map((c: any) => c.stage)).toEqual([
      "extract",
      "assign",
      "compose",
    ]);
  });

  it("compose 第一次幻觉 + 第二次过 → 重试时带 hint, attemptCount=2", async () => {
    // session reports 全空 → 没有 valid refs。第一次返回带 invalid ref 的 citation,
    // 第二次返回空 citations。
    const composeMock = vi
      .fn()
      .mockResolvedValueOnce({
        ...baseCompose,
        citations: [
          { segmentRef: { transcriptId: "tX", segmentIndex: 999 }, quote: "x", themeIds: ["t1"] },
        ],
      })
      .mockResolvedValueOnce({ ...baseCompose, citations: [] });
    const deps = makeDeps({ compose: composeMock });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(200);
    expect(composeMock).toHaveBeenCalledTimes(2);
    // 第二次 compose 调用必须带 hallucinationHint
    expect(composeMock.mock.calls[1][0].hallucinationHint).toMatchObject({
      badRefs: expect.any(Array),
    });
    const args = deps.upsertSpy.mock.calls[0][0];
    expect(args.generationMeta.attemptCount).toBe(2);
    expect(args.generationMeta.hallucinationRatio).toBe(0);
  });

  it("两次都幻觉 → 409 analysis_rejected + 不落库", async () => {
    const allBad = {
      ...baseCompose,
      citations: [
        { segmentRef: { transcriptId: "tX", segmentIndex: 999 }, quote: "x", themeIds: ["t1"] },
        { segmentRef: { transcriptId: "tY", segmentIndex: 888 }, quote: "y", themeIds: ["t2"] },
      ],
    };
    const deps = makeDeps({ compose: async () => allBad });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "analysis_rejected" });
    expect(deps.composeSpy).toHaveBeenCalledTimes(2);
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("themesFinal 落库形态: 含 sentiment, mentions/pct 由代码算 (P-ANL-07)", async () => {
    const deps = makeDeps();
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    const themes = deps.upsertSpy.mock.calls[0][0].body.themes;
    expect(themes).toHaveLength(2);
    const t1 = themes.find((t: any) => t.id === "t1")!;
    expect(t1.sentiment).toBe("positive"); // 来自 baseCompose.themeSentiments
    expect(t1.mentions).toBe(2); // baseAssignments t1: ["sess1","sess2"]
    const t2 = themes.find((t: any) => t.id === "t2")!;
    expect(t2.sentiment).toBe("negative");
    expect(t2.mentions).toBe(1);
    // 原始 pct: t1=100, t2=50 → sum=150 > 100 → normalize 到 sum<=100。
    // 经 enrichSurveyThemes (P-ANL-04 守护): t1=66.67, t2=33.33 (factor=1/1.5)
    expect(t1.pct + t2.pct).toBeLessThanOrEqual(100.1);
    expect(t1.pct).toBeGreaterThan(t2.pct);
  });
});

// =============================================================
// Wave F (D15): chunk + combination 三段式路径
// =============================================================

function buildSessions(n: number): SessionDigest[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `sess${i + 1}`,
    transcriptId: `sess${i + 1}`,
    state: "completed" as const,
    answers: [
      {
        sessionId: `sess${i + 1}`,
        questionId: "q1",
        questionType: "single_choice" as const,
        selectedOptions: ["A"],
      },
    ],
  }));
}

function buildReports(n: number): SessionLevelReport[] {
  return Array.from({ length: n }, (_, i) => ({
    reportId: `ar-${i + 1}`,
    sessionId: `sess${i + 1}`,
    themes: [],
    insights: [],
    citations: [],
    perQuestionSummary: [],
  }));
}

describe("analyzeSurvey Wave F: chunked extract + combine + chunked assign", () => {
  it("N = 10 (边界): 单 chunk 路径, 不调 combine", async () => {
    const deps = makeDeps({
      sessions: buildSessions(10),
      reports: buildReports(10),
    });
    const r = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(r.status).toBe(200);
    expect(deps.extractSpy).toHaveBeenCalledTimes(1);
    expect(deps.combineSpy).not.toHaveBeenCalled();
    expect(deps.assignSpy).toHaveBeenCalledTimes(1); // N≤10 chunk 数=1
    const meta = deps.upsertSpy.mock.calls[0][0].generationMeta;
    expect(meta.createdWith.map((c: any) => c.stage)).toEqual([
      "extract",
      "assign",
      "compose",
    ]);
  });

  it("N = 11 (拆 [10,1]): chunked 路径, extract×2 + combine×1 + assign×2", async () => {
    const deps = makeDeps({
      sessions: buildSessions(11),
      reports: buildReports(11),
    });
    const r = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(r.status).toBe(200);
    expect(deps.extractSpy).toHaveBeenCalledTimes(2);
    expect(deps.combineSpy).toHaveBeenCalledTimes(1);
    expect(deps.assignSpy).toHaveBeenCalledTimes(2);
    const meta = deps.upsertSpy.mock.calls[0][0].generationMeta;
    expect(meta.createdWith.map((c: any) => c.stage)).toEqual([
      "extract",
      "extract",
      "combine",
      "assign",
      "assign",
      "compose",
    ]);
  });

  it("N = 25 (拆 [10,10,5]): extract×3 + combine×1 + assign×3", async () => {
    const deps = makeDeps({
      sessions: buildSessions(25),
      reports: buildReports(25),
    });
    const r = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(r.status).toBe(200);
    expect(deps.extractSpy).toHaveBeenCalledTimes(3);
    expect(deps.combineSpy).toHaveBeenCalledTimes(1);
    expect(deps.assignSpy).toHaveBeenCalledTimes(3);
  });

  it("combine 失败 → 整次 reject (500 llm_unavailable, 不写)", async () => {
    const deps = makeDeps({
      sessions: buildSessions(11),
      reports: buildReports(11),
      combine: async () => {
        throw new Error("combine LLM down");
      },
    });
    const r = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(r.status).toBe(500);
    // P-SEC-04: body is exactly { error: <code> } (no raw "combine LLM down").
    expect(r.body).toEqual({ error: "llm_unavailable" });
    expect(deps.upsertSpy).not.toHaveBeenCalled();
    // assign 不应被调到 (combine 失败短路)
    expect(deps.assignSpy).not.toHaveBeenCalled();
  });

  it("chunked 路径 themes 经 mergeThemeAssignments 后 mentions 不重计 (P-ANL-08 联动)", async () => {
    const deps = makeDeps({
      sessions: buildSessions(11),
      reports: buildReports(11),
      // assign 在两 chunk 都把 themeId='t1' 分给 sess1 (重叠), 期望 dedupe 后 mentions=不超过 1
      assign: async (input: any) => ({
        assignments: [
          {
            themeId: "t1",
            sessionIds: input.sessionReports.map((r: any) => r.sessionId),
            evidenceRefs: [],
          },
        ],
      }),
      combine: async (input: any) => input.rawThemesList[0], // 透传第一份
    });
    const r = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(r.status).toBe(200);
    const stored = deps.upsertSpy.mock.calls[0][0].body.themes;
    const t1 = stored.find((t: any) => t.id === "t1");
    // 11 个 session 全部分给 t1, mentions=11, pct=100
    expect(t1?.mentions).toBe(11);
    expect(t1?.pct).toBeCloseTo(100, 1);
  });
});
