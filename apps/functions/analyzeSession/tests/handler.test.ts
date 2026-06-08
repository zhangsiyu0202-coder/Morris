import { describe, it, expect, vi } from "vitest";
import {
  analyzeSession,
  type AnalyzeSessionDeps,
  type SessionRecord,
  type SurveyContext,
  type TranscriptRecord,
} from "../src/handler";
import type { AnalysisReportOutput, VisualAnalysisOutput } from "@merism/contracts";

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

const baseVisualOutput: VisualAnalysisOutput = {
  source: "recording",
  recordingFileId: "file-sess1",
  durationMs: 62000,
  visualConfirmation: true,
  summary: "受访者在展示刺激物时有明显停顿,随后继续回答。",
  sentiment: "mixed",
  tags: ["hesitation", "stimulus-review"],
  segments: [
    {
      id: "vseg_1",
      startMs: 0,
      endMs: 30000,
      title: "查看刺激物",
      description: "受访者注视屏幕并短暂停顿,随后开始评价设计。",
      evidence: [{ transcriptId: "sess1", segmentIndex: 0 }],
      observations: ["受访者先停顿再继续回答。"],
      issueLevel: "minor",
    },
  ],
  keyMoments: [
    {
      id: "vmoment_1",
      timestampMs: 12000,
      label: "明显停顿",
      description: "受访者在回答前停顿,像是在重新阅读刺激物。",
      segmentId: "vseg_1",
    },
  ],
};

interface DepsOverrides {
  session?: SessionRecord | null;
  transcript?: TranscriptRecord | null;
  survey?: SurveyContext | null;
  llm?: () => Promise<AnalysisReportOutput>;
  visual?: () => Promise<VisualAnalysisOutput>;
  upsert?: (args: any) => Promise<{ reportId: string }>;
}

function makeDeps(overrides: DepsOverrides = {}): AnalyzeSessionDeps & {
  upsertSpy: ReturnType<typeof vi.fn>;
  llmSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn(
    overrides.upsert ?? (async () => ({ reportId: "ar-new" })),
  );
  const llmSpy = vi.fn(overrides.llm ?? (async () => baseLlmOutput));
  return {
    now: () => Date.UTC(2026, 5, 6, 0, 0, 0),
    findSession: async () => ("session" in overrides ? overrides.session : baseSession) as SessionRecord | null,
    findTranscript: async () =>
      ("transcript" in overrides ? overrides.transcript : baseTranscript) as TranscriptRecord | null,
    findSurveyContext: async () =>
      ("survey" in overrides ? overrides.survey : baseSurvey) as SurveyContext | null,
    analyzeWithLLM: llmSpy,
    findRecording: async () =>
      overrides.visual
        ? {
            $id: "rec1",
            sessionId: "sess1",
            ownerUserId: "user-owner",
            storageFileId: "file-sess1",
            durationMs: 62000,
            format: "webm",
          }
        : null,
    getRecordingBytes: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/webm",
    }),
    analyzeRecordingVisuals: overrides.visual ? vi.fn(overrides.visual) : undefined,
    upsertSessionReport: upsertSpy,
    upsertSpy,
    llmSpy,
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

  it("adds visual analysis to the saved session report when a visual provider is configured", async () => {
    const deps = makeDeps({
      visual: async () => baseVisualOutput,
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    const call = deps.upsertSpy.mock.calls[0][0];
    expect(call.body.visualAnalysis).toEqual(baseVisualOutput);
  });

  it("returns a clear error when the configured visual provider fails", async () => {
    const deps = makeDeps({
      visual: async () => {
        throw new Error("video model unavailable");
      },
    });
    const result = await analyzeSession({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: "visual_analysis_failed" });
    expect(deps.upsertSpy).not.toHaveBeenCalled();
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
