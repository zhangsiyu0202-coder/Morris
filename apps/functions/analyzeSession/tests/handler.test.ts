import { describe, it, expect, vi } from "vitest";
import {
  analyzeSession,
  type AnalyzeSessionDeps,
  type SessionRecord,
  type SurveyContext,
  type TranscriptRecord,
} from "../src/handler";
import type { AnalysisReportOutput } from "@merism/contracts";

const baseSession: SessionRecord = {
  $id: "sess1",
  surveyId: "sv1",
  state: "completed",
  collectedAnswers: { q1: "A" },
};

const baseTranscript: TranscriptRecord = {
  $id: "t1",
  sessionId: "sess1",
  segments: [
    { speaker: "interviewee", startMs: 0, endMs: 1000, text: "I love the new design." },
  ],
  language: "zh",
};

const baseSurvey: SurveyContext = {
  surveyId: "sv1",
  ownerUserId: "user-owner",
  title: "Test Study",
  flowConfig: {},
  sections: [
    { $id: "sec1", surveyId: "sv1", title: "Sec", description: "", order: 0 },
  ],
  questionBlocks: [
    {
      $id: "q1",
      surveyId: "sv1",
      sectionId: "sec1",
      order: 0,
      orderInSection: 0,
      type: "open_ended",
      prompt: "Tell me.",
      config: {},
    },
  ],
};

const baseLlmOutput: AnalysisReportOutput = {
  scope: "session",
  themes: [
    {
      id: "t1",
      label: "Design appreciation",
      description: "User likes the new design.",
      evidence: [{ transcriptId: "sess1", segmentIndex: 0 }],
    },
  ],
  insights: [
    { id: "i1", statement: "Design lands well.", supportingThemes: ["t1"], confidence: 0.8 },
  ],
  citations: [
    {
      segmentRef: { transcriptId: "sess1", segmentIndex: 0 },
      quote: "I love the new design.",
      themeIds: ["t1"],
    },
  ],
  perQuestionSummary: [{ questionId: "q1", summary: "Positive.", sentiment: "positive" }],
  rendered: null,
};

interface DepsOverrides {
  session?: SessionRecord | null;
  transcript?: TranscriptRecord | null;
  survey?: SurveyContext | null;
  llm?: () => Promise<AnalysisReportOutput>;
  enqueue?: () => Promise<void>;
  upsert?: (args: any) => Promise<{ reportId: string }>;
}

function makeDeps(overrides: DepsOverrides = {}): AnalyzeSessionDeps & {
  upsertSpy: ReturnType<typeof vi.fn>;
  llmSpy: ReturnType<typeof vi.fn>;
  enqueueSpy: ReturnType<typeof vi.fn>;
  ensureSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn(
    overrides.upsert ?? (async () => ({ reportId: "ar-new" })),
  );
  const llmSpy = vi.fn(overrides.llm ?? (async () => baseLlmOutput));
  const enqueueSpy = vi.fn(overrides.enqueue ?? (async () => undefined));
  const ensureSpy = vi.fn(async () => undefined);
  return {
    now: () => Date.UTC(2026, 5, 6, 0, 0, 0),
    findSession: async () => ("session" in overrides ? overrides.session : baseSession) as SessionRecord | null,
    findTranscript: async () =>
      ("transcript" in overrides ? overrides.transcript : baseTranscript) as TranscriptRecord | null,
    findSurveyContext: async () =>
      ("survey" in overrides ? overrides.survey : baseSurvey) as SurveyContext | null,
    analyzeWithLLM: llmSpy,
    ensureVisualJobQueued: ensureSpy,
    enqueueVisualAnalysis: enqueueSpy,
    upsertSessionReport: upsertSpy,
    upsertSpy,
    llmSpy,
    enqueueSpy,
    ensureSpy,
  } as any;
}

describe("analyzeSession handler", () => {
  it("rejects invalid input with 400", async () => {
    const deps = makeDeps();
    const result = await analyzeSession({}, deps);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_input" });
  });

  it("returns 404 when session not found", async () => {
    const deps = makeDeps({ session: null });
    const result = await analyzeSession({ sessionId: "missing" }, deps);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "session_not_found" });
    expect(deps.llmSpy).not.toHaveBeenCalled();
  });

  it("returns 409 when session is not completed", async () => {
    const deps = makeDeps({
      session: { ...baseSession, state: "in_progress" },
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "session_not_completed" });
    expect(deps.llmSpy).not.toHaveBeenCalled();
    expect(deps.upsertSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when transcript is missing", async () => {
    const deps = makeDeps({ transcript: null });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "transcript_not_found" });
    expect(deps.llmSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when survey context is missing", async () => {
    const deps = makeDeps({ survey: null });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "survey_not_found" });
  });

  it("returns 500 when LLM throws", async () => {
    const deps = makeDeps({
      llm: async () => {
        throw new Error("upstream timeout");
      },
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
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
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: "persist_failed" });
  });

  it("returns 200 with reportId on the happy path and forwards owner+survey", async () => {
    const deps = makeDeps();
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reportId: "ar-new", scope: "session" });
    // Upsert was called once with the right keys, including ownerUserId.
    expect(deps.upsertSpy).toHaveBeenCalledTimes(1);
    const call = deps.upsertSpy.mock.calls[0][0];
    expect(call).toMatchObject({
      sessionId: "sess1",
      surveyId: "sv1",
      ownerUserId: "user-owner",
    });
    expect(call.body).toEqual(baseLlmOutput);
    // generatedAt is an ISO string sourced from deps.now()
    expect(call.generatedAt).toMatch(/^2026-06-06T/);
  });

  it("enqueues the async visual pipeline after persisting the report (ADR 0005 D1)", async () => {
    const deps = makeDeps();
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(deps.ensureSpy).toHaveBeenCalledWith({
      sessionId: "sess1",
      surveyId: "sv1",
      ownerUserId: "user-owner",
    });
    expect(deps.enqueueSpy).toHaveBeenCalledWith("sess1");
    // The text report is persisted regardless; visualAnalysis is patched later
    // by analyzeSessionVisual, not inline here.
    const call = deps.upsertSpy.mock.calls[0][0];
    expect(call.body.visualAnalysis).toBeUndefined();
  });

  it("does not fail the text analysis when enqueue throws (best-effort)", async () => {
    const deps = makeDeps({
      enqueue: async () => {
        throw new Error("functions.createExecution unavailable");
      },
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reportId: "ar-new", scope: "session" });
    expect(deps.upsertSpy).toHaveBeenCalled();
  });

  it("is idempotent at the deps boundary: same sessionId resolves to same report row", async () => {
    // The handler does not implement idempotency itself; it delegates to deps.
    // We assert the contract: handler always calls upsert with the same key.
    const calls: any[] = [];
    const deps = makeDeps({
      upsert: async (args) => {
        calls.push(args);
        return { reportId: "ar-stable" };
      },
    });
    await analyzeSession({ sessionId: "sess1" }, deps);
    await analyzeSession({ sessionId: "sess1" }, deps);
    expect(calls).toHaveLength(2);
    expect(calls[0].sessionId).toBe(calls[1].sessionId);
    expect(calls[0].surveyId).toBe(calls[1].surveyId);
  });
});

// =============================================================================
// analysis-report-v2 新增测试 (T15)
// 覆盖 R3 hallucination reject/retry + R1 qualityFlags 双写 + R2 generationMeta
// =============================================================================

describe("analyzeSession v2: hallucination + qualityFlags + generationMeta", () => {
  function makeV2Deps(opts: {
    llm?: any;
    qualityLLM?: any;
    updateFlags?: any;
    updateErr?: any;
    upsert?: any;
  } = {}) {
    const llmSpy = vi.fn(opts.llm ?? (async () => baseLlmOutput));
    const qualitySpy = vi.fn(opts.qualityLLM ?? (async () => ({ flags: ["fluent"] })));
    const flagsSpy = vi.fn(opts.updateFlags ?? (async () => undefined));
    const errSpy = vi.fn(opts.updateErr ?? (async () => undefined));
    const upsertSpy = vi.fn(opts.upsert ?? (async () => ({ reportId: "ar-1" })));
    return {
      now: () => Date.UTC(2026, 5, 6),
      findSession: async () => baseSession,
      findTranscript: async () => baseTranscript,
      findSurveyContext: async () => baseSurvey,
      analyzeWithLLM: llmSpy,
      deriveQualityFlagsWithLLM: qualitySpy,
      updateInterviewSessionFlags: flagsSpy,
      updateSessionErrorContext: errSpy,
      upsertSessionReport: upsertSpy,
      llmSpy, qualitySpy, flagsSpy, errSpy, upsertSpy,
    } as any;
  }

  it("happy path 短文本: 规则层 silent → LLM 跳过 (D10) + writeback ['silent']", async () => {
    // baseTranscript 受访者只说了 22 字符 — 低于 SILENT_RESPONDENT_MIN_CHARS=50,
    // 规则层判定 silent, 按 D10, LLM 阶段 (deriveQualityFlagsWithLLM) 跳过。
    const deps = makeV2Deps();
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(deps.llmSpy).toHaveBeenCalledTimes(1);
    expect(deps.qualitySpy).not.toHaveBeenCalled(); // D10
    expect(deps.upsertSpy).toHaveBeenCalledOnce();
    const args = deps.upsertSpy.mock.calls[0][0];
    expect(args.generationMeta).toMatchObject({
      promptVersion: "session.v2.0",
      attemptCount: 1,
      hallucinationRatio: 0,
    });
    expect(args.generationMeta.createdWith.length).toBeGreaterThanOrEqual(2);
    expect(deps.flagsSpy).toHaveBeenCalledOnce();
    expect(deps.flagsSpy.mock.calls[0][0]).toBe("sess1");
    expect(deps.flagsSpy.mock.calls[0][1]).toEqual(["silent"]);
    expect(deps.errSpy).not.toHaveBeenCalled();
  });

  it("happy path 长文本: 规则层无 mechanical → LLM 介入 → flags 含 LLM 推导值", async () => {
    // 给一个 long transcript 让规则层不触发 silent / too-short。
    const longTranscript: TranscriptRecord = {
      $id: "t1",
      sessionId: "sess1",
      language: "zh",
      segments: [
        { speaker: "interviewer", startMs: 0, endMs: 1000, text: "请展开讲讲。" },
        { speaker: "respondent", startMs: 1000, endMs: 60000, text: "x".repeat(500) },
      ],
    };
    const deps = makeV2Deps({ qualityLLM: async () => ({ flags: ["fluent", "deep-engagement"] }) });
    deps.findTranscript = async () => longTranscript;

    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(deps.qualitySpy).toHaveBeenCalledOnce(); // 与 D10 反义路径
    const flags = deps.flagsSpy.mock.calls[0][1];
    expect(flags).toContain("fluent");
    expect(flags).toContain("deep-engagement");
  });

  it("第一次幻觉 + 第二次过 → 重试时带 hint, attemptCount=2, ratio=通过那次", async () => {
    const badThenGood = vi
      .fn()
      .mockResolvedValueOnce({
        ...baseLlmOutput,
        themes: [
          {
            id: "t1",
            label: "x",
            description: "x",
            evidence: [
              { transcriptId: "sess1", segmentIndex: 0 },
              { transcriptId: "sess1", segmentIndex: 99 },
              { transcriptId: "sess1", segmentIndex: 88 },
            ],
          },
        ],
        citations: [
          { segmentRef: { transcriptId: "sess1", segmentIndex: 77 }, quote: "x", themeIds: ["t1"] },
        ],
      })
      .mockResolvedValueOnce(baseLlmOutput);
    const deps = makeV2Deps({ llm: badThenGood });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(badThenGood).toHaveBeenCalledTimes(2);
    // 第二次必须带 hallucinationHint
    const secondCall = badThenGood.mock.calls[1];
    expect(secondCall[1]).toMatchObject({ hallucinationHint: { badRefs: expect.any(Array) } });
    expect(secondCall[1].hallucinationHint.badRefs.length).toBeGreaterThan(0);
    // upsert 含 attemptCount=2 与 通过那次的 ratio (=0)
    const args = deps.upsertSpy.mock.calls[0][0];
    expect(args.generationMeta.attemptCount).toBe(2);
    expect(args.generationMeta.hallucinationRatio).toBe(0);
  });

  it("两次都幻觉 → 409 analysis_rejected + 写 errorContext + 不落库 + 不双写 flags", async () => {
    const allBad = {
      ...baseLlmOutput,
      themes: [
        {
          id: "t1",
          label: "x",
          description: "x",
          evidence: [
            { transcriptId: "sess1", segmentIndex: 99 },
            { transcriptId: "sess1", segmentIndex: 88 },
          ],
        },
      ],
      citations: [
        { segmentRef: { transcriptId: "sess1", segmentIndex: 77 }, quote: "x", themeIds: ["t1"] },
      ],
    };
    const deps = makeV2Deps({ llm: async () => allBad });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: "analysis_rejected" });
    expect(deps.llmSpy).toHaveBeenCalledTimes(2);
    expect(deps.upsertSpy).not.toHaveBeenCalled();
    expect(deps.flagsSpy).not.toHaveBeenCalled();
    expect(deps.errSpy).toHaveBeenCalledOnce();
    const ctx = deps.errSpy.mock.calls[0][1];
    expect(ctx.reason).toBe("hallucination_threshold_exceeded");
    expect(ctx.attemptCount).toBe(3);
    expect(ctx.badRefs.length).toBeLessThanOrEqual(10);
    expect(ctx.promptVersion).toBe("session.v2.0");
  });

  it("D6: qualityFlags 双写失败仍返回 200 (best-effort)", async () => {
    const deps = makeV2Deps({
      updateFlags: async () => {
        throw new Error("appwrite write failed");
      },
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(deps.upsertSpy).toHaveBeenCalledOnce();
    expect(deps.flagsSpy).toHaveBeenCalledOnce();
  });
});
