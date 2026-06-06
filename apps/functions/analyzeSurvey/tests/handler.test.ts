import { describe, it, expect, vi } from "vitest";
import {
  analyzeSurvey,
  type AnalyzeSurveyDeps,
  type LlmRollupOutput,
  type SessionDigest,
  type SessionLevelReport,
  type SurveyContextLite,
} from "../src/handler";

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

const baseLlm: LlmRollupOutput = {
  themes: [
    { id: "t1", label: "Choice quality", mentions: 5, pct: 60, sentiment: "positive" },
    { id: "t2", label: "Pricing", mentions: 3, pct: 30, sentiment: "negative" },
  ],
  insights: [{ id: "i1", title: "Top driver", text: "Choice", confidence: 0.7 }],
  citations: [],
  sentimentBreakdown: [
    { sentiment: "positive", count: 1 },
    { sentiment: "neutral", count: 1 },
    { sentiment: "negative", count: 0 },
  ],
  topics: ["LLM topic"],
  questionSummaries: { q1: "Even split between A and B." },
};

interface Overrides {
  survey?: SurveyContextLite | null;
  sessions?: SessionDigest[];
  reports?: SessionLevelReport[];
  llm?: () => Promise<LlmRollupOutput>;
  upsert?: (args: any) => Promise<{ reportId: string }>;
}

function makeDeps(overrides: Overrides = {}): AnalyzeSurveyDeps & {
  upsertSpy: ReturnType<typeof vi.fn>;
  llmSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn(overrides.upsert ?? (async () => ({ reportId: "ar-survey" })));
  const llmSpy = vi.fn(overrides.llm ?? (async () => baseLlm));
  return {
    now: () => Date.UTC(2026, 5, 6, 0, 0, 0),
    findSurveyContext: async () =>
      ("survey" in overrides ? overrides.survey : baseSurvey) as SurveyContextLite | null,
    findCompletedSessions: async () => overrides.sessions ?? baseSessions,
    findSessionReports: async () => overrides.reports ?? baseSessionReports,
    rollupWithLLM: llmSpy,
    upsertSurveyReport: upsertSpy,
    upsertSpy,
    llmSpy,
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
    expect(deps.llmSpy).not.toHaveBeenCalled();
  });

  it("returns 409 when no sessions are completed", async () => {
    const deps = makeDeps({ sessions: [] });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "no_completed_sessions" });
    expect(deps.llmSpy).not.toHaveBeenCalled();
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when LLM throws", async () => {
    const deps = makeDeps({
      llm: async () => {
        throw new Error("upstream");
      },
    });
    const result = await analyzeSurvey({ surveyId: "sv1" }, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: "llm_unavailable" });
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
    expect(result.body).toMatchObject({ error: "persist_failed" });
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

  it("clamps theme share to <= 100 (P-ANL-04 invariant)", async () => {
    const deps = makeDeps({
      llm: async () => ({
        ...baseLlm,
        themes: [
          { id: "t1", label: "Over-1", mentions: 10, pct: 80, sentiment: "positive" },
          { id: "t2", label: "Over-2", mentions: 8, pct: 70, sentiment: "negative" },
        ],
      }),
    });
    await analyzeSurvey({ surveyId: "sv1" }, deps);
    const stored = deps.upsertSpy.mock.calls[0][0].body.themes;
    const sum = stored.reduce((acc: number, t: any) => acc + t.pct, 0);
    expect(sum).toBeLessThanOrEqual(100.1); // small float slack from rounding
  });

  it("falls back to survey topics when LLM returns no topics", async () => {
    const deps = makeDeps({
      llm: async () => ({ ...baseLlm, topics: [] }),
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
