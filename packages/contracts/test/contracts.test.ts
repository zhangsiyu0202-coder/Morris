import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  AnalysisReportSchema,
  AnalysisReportOutputSchema,
  BookmarkSchema,
  DashboardSchema,
  DashboardTileSchema,
  DashboardWidgetRunInputSchema,
  DashboardWidgetSchema,
  RunDashboardWidgetsOutputSchema,
  buildInterviewRoomMetadataFromDraft,
  buildInterviewRuntimeStudy,
  canTransitionSurveyStatus,
  NotebookSchema,
  notebookReportSchema,
  RecordingFormat,
  IssueLivekitTokenRequestSchema,
  IssueLivekitTokenResponseSchema,
  InterviewLinkSchema,
  SurveyAnalysisReportOutputSchema,
  SubmitInterviewAnswerRpcResponseSchema,
  SurveyDraftSchema,
  SurveyQuestionStatSchema,
  type SurveyAnalysisReportOutput,
} from "@merism/contracts";

describe("contracts: RecordingFormat", () => {
  it("accepts video and legacy audio formats", () => {
    for (const format of ["mp4", "webm", "mp3", "opus", "wav"] as const) {
      expect(RecordingFormat.parse(format)).toBe(format);
    }
  });
});

describe("contracts: dashboard widgets", () => {
  it("models a study dashboard with widget tiles and run results", () => {
    const now = new Date().toISOString();
    const dashboard = DashboardSchema.parse({
      $id: "dash1",
      ownerUserId: "owner1",
      surveyId: "survey1",
      scope: "study",
      name: "Research dashboard",
      presetId: "study_overview",
      createdAt: now,
      updatedAt: now,
    });
    const widget = DashboardWidgetSchema.parse({
      $id: "widget1",
      ownerUserId: dashboard.ownerUserId,
      dashboardId: dashboard.$id,
      surveyId: dashboard.surveyId,
      widgetType: "study_progress",
      config: {},
      createdAt: now,
      updatedAt: now,
    });
    const tile = DashboardTileSchema.parse({
      $id: "tile1",
      ownerUserId: dashboard.ownerUserId,
      dashboardId: dashboard.$id,
      surveyId: dashboard.surveyId,
      widgetId: widget.$id,
      layout: { x: 0, y: 0, w: 4, h: 2 },
      order: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(tile.widgetId).toBe(widget.$id);
    expect(
      DashboardWidgetRunInputSchema.parse({
        dashboardId: dashboard.$id,
        surveyId: dashboard.surveyId,
        tileIds: [tile.$id],
      }).tileIds,
    ).toEqual(["tile1"]);
    expect(
      RunDashboardWidgetsOutputSchema.parse({
        results: [
          {
            tileId: tile.$id,
            widgetId: widget.$id,
            widgetType: widget.widgetType,
            result: { completedSessions: 1, totalSessions: 2, completionRate: 50 },
            error: null,
          },
        ],
      }).results[0]?.widgetType,
    ).toBe("study_progress");
  });
});

describe("contracts: issueLivekitToken request", () => {
  it("accepts any non-empty linkToken with optional alias", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: undefined }),
        (linkToken, alias) => {
          const parsed = IssueLivekitTokenRequestSchema.parse({ linkToken, alias });
          expect(parsed.linkToken).toBe(linkToken);
        },
      ),
    );
  });

  it("rejects empty linkToken", () => {
    expect(IssueLivekitTokenRequestSchema.safeParse({ linkToken: "" }).success).toBe(false);
  });
});

describe("contracts: IssueLivekitTokenResponse linkKind", () => {
  it("defaults linkKind to production when omitted", () => {
    const parsed = IssueLivekitTokenResponseSchema.parse({
      sessionId: "sess1",
      livekitUrl: "ws://localhost:7880",
      token: "tok",
      surveyMeta: { surveyId: "survey1", title: "Demo" },
    });
    expect(parsed.linkKind).toBe("production");
  });

  it("preserves linkKind=test when present", () => {
    const parsed = IssueLivekitTokenResponseSchema.parse({
      sessionId: "sess1",
      livekitUrl: "ws://localhost:7880",
      token: "tok",
      surveyMeta: { surveyId: "survey1", title: "Demo" },
      linkKind: "test",
    });
    expect(parsed.linkKind).toBe("test");
  });
});

describe("contracts: InterviewLink usedCount invariant (P-DATA-05 shape)", () => {
  it("defaults usedCount to 0 and requires positive maxUses", () => {
    const link = InterviewLinkSchema.parse({
      $id: "l1",
      surveyId: "s1",
      token: "tok",
      mode: "single_use",
      maxUses: 1,
      expiresAt: new Date().toISOString(),
    });
    expect(link.usedCount).toBe(0);
    expect(link.kind).toBe("production");
    expect(InterviewLinkSchema.safeParse({ ...link, maxUses: 0 }).success).toBe(false);
  });

  it("accepts kind=test for researcher self-test links", () => {
    const link = InterviewLinkSchema.parse({
      $id: "l1",
      surveyId: "s1",
      token: "tok",
      mode: "reusable",
      kind: "test",
      maxUses: 100,
      expiresAt: new Date().toISOString(),
    });
    expect(link.kind).toBe("test");
  });
});

describe("contracts: survey draft shape", () => {
  it("accepts a qualitative interview draft", () => {
    const draft = SurveyDraftSchema.parse({
      title: "Coffee subscription onboarding research",
        instruction: "## 研究意图\n了解新订阅者如何评估咖啡配送服务。",
      sections: [
        {
          title: "Warm-up",
          objective: "Understand the participant context.",
          questions: [
            {
              questionText: "Tell me about the last time you ordered specialty coffee online.",
              questionType: "open_ended",
              probeLevel: "standard",
              probeInstruction: "Ask for context, decision factors, and any friction in the journey.",
            },
          ],
        },
      ],
    });

    expect(draft.sections[0]?.questions[0]?.probeLevel).toBe("standard");
  });

  it("trims surrounding whitespace and rejects blank-only strings", () => {
    const draft = SurveyDraftSchema.parse({
      title: "  Coffee study  ",
        instruction: "  ## 研究意图\n了解订阅者。  ",
      sections: [
        {
          title: " Warm-up ",
          objective: " Context. ",
          questions: [{ questionText: "  Tell me more.  ", questionType: "open_ended" }],
        },
      ],
    });
    // 正例: 前后空白被裁掉。
    expect(draft.title).toBe("Coffee study");
    expect(draft.sections[0]?.title).toBe("Warm-up");
    expect(draft.sections[0]?.questions[0]?.questionText).toBe("Tell me more.");

    // 反例: 纯空白 questionText 裁成 "" 后被 min(1) 拒绝。
    expect(
      SurveyDraftSchema.safeParse({
        title: "Blank question draft",
        instruction: "## 研究意图\nGoal.",
        sections: [
          {
            title: "Section 1",
            objective: "Collect answers.",
            questions: [{ questionText: "   ", questionType: "open_ended" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects choice questions without enough options", () => {
    expect(
      SurveyDraftSchema.safeParse({
        title: "Bad draft",
        instruction: "## 研究意图\nTest validation.",
        sections: [
          {
            title: "Section 1",
            objective: "Collect answers.",
            questions: [
              {
                questionText: "Pick one.",
                questionType: "single_choice",
                probeLevel: "standard",
                options: ["Only option"],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("maps a study draft to interview runtime questions", () => {
    const runtime = buildInterviewRuntimeStudy({
      surveyId: "survey-1",
      draft: SurveyDraftSchema.parse({
        title: "Concept reaction study",
        instruction: "## 研究意图\n了解用户对新概念的反应。",
        sections: [
          {
            title: "Warm-up",
            objective: "Get the participant talking.",
            questions: [
              {
                questionText: "What comes to mind first when you think about this category?",
                questionType: "open_ended",
                probeLevel: "standard",
                probeInstruction: "Ask for a concrete recent example.",
              },
            ],
          },
        ],
      }),
    });

    expect(runtime.sections[0]?.questions[0]?.responseMode).toBe("voice_only");
    expect(runtime.sections[0]?.questions[0]?.questionId).toBe("question-1-1");
  });

  it("builds flow-only room metadata while retaining runtime question progress", () => {
    const metadata = buildInterviewRoomMetadataFromDraft({
      surveyId: "survey-1",
      sessionId: "session-1",
      draft: SurveyDraftSchema.parse({
        title: "Retention study",
        instruction: "## 研究意图\n了解用户持续活跃的原因。",
        sections: [
          {
            title: "Opening",
            objective: "Get grounded in a recent experience.",
            questions: [
              {
                questionText: "Tell me about a recent time you used the product.",
                questionType: "open_ended",
                probeLevel: "standard",
                probeInstruction: "Ask what they were trying to accomplish.",
              },
            ],
          },
        ],
      }),
    });

    expect(metadata.runtimeStudy?.sections[0]?.questions[0]?.questionId).toBe("question-1-1");
    expect(metadata).not.toHaveProperty("workflowConfig");
    expect(metadata.flowConfig?.moderatorInstruction).toBe("## 研究意图\n了解用户持续活跃的原因。");
  });
});

describe("contracts: AnalysisReport scope invariants (ADR-0003 D1/D4)", () => {
  it("rejects scope=session without sessionId", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r1",
      surveyId: "sv1",
      scope: "session",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects scope=survey without surveyId", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r2",
      sessionId: "sess1",
      scope: "survey",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects scope=survey carrying a sessionId", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r3",
      sessionId: "sess1",
      surveyId: "sv1",
      scope: "survey",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts scope=session with sessionId only", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r4",
      sessionId: "sess1",
      surveyId: "sv1",
      scope: "session",
      ownerUserId: "user1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts scope=survey with surveyId and no sessionId", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r5",
      surveyId: "sv1",
      scope: "survey",
      ownerUserId: "user1",
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a session report with recording visual analysis", () => {
    const result = AnalysisReportOutputSchema.safeParse({
      scope: "session",
      themes: [
        {
          id: "theme1",
          label: "Visual hesitation",
          description: "Participant hesitated when reading the stimulus.",
          evidence: [{ transcriptId: "sess1", segmentIndex: 0 }],
        },
      ],
      insights: [],
      citations: [],
      perQuestionSummary: [],
      rendered: null,
      visualAnalysis: {
        source: "recording",
        recordingFileId: "file1",
        durationMs: 45000,
        visualConfirmation: true,
        summary: "Participant paused on the stimulus before answering.",
        segments: [
          {
            id: "vseg1",
            startMs: 0,
            endMs: 30000,
            title: "Stimulus review",
            description: "The participant visually reviewed the stimulus.",
            evidence: [{ transcriptId: "sess1", segmentIndex: 0 }],
          },
        ],
        keyMoments: [
          {
            id: "vmoment1",
            timestampMs: 12000,
            label: "Pause",
            description: "A visible pause before answering.",
            segmentId: "vseg1",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("contracts: SurveyAnalysisReportOutput discriminated union", () => {
  it("accepts a minimally complete survey-level report", () => {
    const minimal: SurveyAnalysisReportOutput = {
      surveyId: "sv1",
      surveyTitle: "Test",
      totalRespondents: 0,
      completedRespondents: 0,
      avgDurationLabel: "0:00",
      lastUpdatedLabel: "just now",
      topics: [],
      questionStats: [],
      sentimentBreakdown: [],
      themes: [],
      insights: [],
      citations: [],
      rendered: null,
    };
    expect(SurveyAnalysisReportOutputSchema.parse(minimal)).toEqual(minimal);
  });

  it("discriminates choice / rating / nps question stats", () => {
    const stats = SurveyQuestionStatSchema.array().parse([
      {
        questionId: "q1",
        questionText: "Pick one",
        kind: "choice",
        multi: false,
        total: 10,
        reportQuestion: "Which option?",
        summary: "Most picked A.",
        data: [{ label: "A", count: 7, pct: 70 }],
      },
      {
        questionId: "q2",
        questionText: "Score it",
        kind: "rating",
        total: 10,
        average: 4.2,
        scaleMax: 5,
        reportQuestion: "How satisfied?",
        summary: "Mostly happy.",
        data: [{ score: 5, count: 6 }],
      },
      {
        questionId: "q3",
        questionText: "Recommend?",
        kind: "nps",
        total: 10,
        score: 30,
        promoters: 5,
        passives: 3,
        detractors: 2,
        reportQuestion: "NPS",
        summary: "Net positive.",
      },
    ]);
    expect(stats[0]?.kind).toBe("choice");
    expect(stats[1]?.kind).toBe("rating");
    expect(stats[2]?.kind).toBe("nps");
  });
});

describe("contracts: SubmitInterviewAnswerRpcResponse accepted flag", () => {
  it("round-trips an accepted advance", () => {
    const res = SubmitInterviewAnswerRpcResponseSchema.parse({
      ok: true,
      accepted: true,
      nextQuestionId: "q2",
      completed: false,
    });
    expect(res.accepted).toBe(true);
    expect(res.nextQuestionId).toBe("q2");
  });

  it("round-trips a rejected (stale/duplicate) submit", () => {
    const res = SubmitInterviewAnswerRpcResponseSchema.parse({
      ok: true,
      accepted: false,
      nextQuestionId: "q1",
      completed: false,
    });
    expect(res.accepted).toBe(false);
  });

  it("requires the accepted flag", () => {
    expect(
      SubmitInterviewAnswerRpcResponseSchema.safeParse({
        ok: true,
        completed: true,
      }).success,
    ).toBe(false);
  });
});

describe("contracts: survey status transitions", () => {
  it("allows publish, pause, close, then archive", () => {
    expect(canTransitionSurveyStatus("draft", "published")).toBe(true);
    expect(canTransitionSurveyStatus("published", "paused")).toBe(true);
    expect(canTransitionSurveyStatus("paused", "closed")).toBe(true);
    expect(canTransitionSurveyStatus("closed", "archived")).toBe(true);
  });

  it("rejects skipping closed before archive", () => {
    expect(canTransitionSurveyStatus("published", "archived")).toBe(false);
    expect(canTransitionSurveyStatus("paused", "archived")).toBe(false);
  });
});

describe("contracts: Notebook entity (Wave F: legacy Insight rename + report 字段已删除)", () => {
  it("accepts a fully-populated notebook (Wave F shape)", () => {
    const nb = NotebookSchema.parse({
      $id: "i1",
      studyId: "st1",
      studyTitle: "S",
      question: "Why did people churn?",
      ownerUserId: "u1",
      shortId: "abc123def456",
      content: '{"type":"doc","content":[]}',
      textContent: "Pricing analysis text content",
      headline: "Pricing is the leading driver",
      summary: "Direct answer",
      confidence: "high",
      sampleSize: 12,
      visibility: "internal",
      embedding: "",
      embeddingModel: "",
      createdAt: "2026-06-06T00:00:00.000Z",
    });
    expect(nb.confidence).toBe("high");
    expect(nb.shortId).toBe("abc123def456");
    expect(nb.visibility).toBe("internal");
    // Wave F (T48): legacy `report` field is no longer part of NotebookSchema.
    expect(nb).not.toHaveProperty("report");
  });

  it("notebookReportSchema is still exported as DeepSeek experimental_output 中间格式", () => {
    const r = notebookReportSchema.parse({
      headline: "X",
      directAnswer: "Y",
      confidence: "high",
      confidenceReason: "z",
      themes: [],
      divergences: [],
      actions: [],
    });
    expect(r.confidence).toBe("high");
  });
});

describe("contracts: Bookmark note + tags", () => {
  const base = {
    $id: "bm_1",
    ownerUserId: "u_1",
    surveyId: "s_1",
    sessionId: "sess_1",
    quote: "我觉得这个流程太复杂了",
    source: "用户研究 · Q2",
    respondent: "受访者 · 01:23",
    segmentIndex: 3,
    createdAt: "2026-06-12T05:00:00.000Z",
  };

  it("defaults note to empty string and tags to empty array when absent", () => {
    const parsed = BookmarkSchema.parse(base);
    expect(parsed.note).toBe("");
    expect(parsed.tags).toEqual([]);
  });

  it("preserves a researcher's note and tags through parse", () => {
    const parsed = BookmarkSchema.parse({
      ...base,
      note: "对照 P0 痛点,值得在报告里引用",
      tags: ["痛点", "导航"],
    });
    expect(parsed.note).toBe("对照 P0 痛点,值得在报告里引用");
    expect(parsed.tags).toEqual(["痛点", "导航"]);
  });

  it("carries the absolute recording offset (startMs) seek anchor", () => {
    const parsed = BookmarkSchema.parse({ ...base, startMs: 83000 });
    expect(parsed.startMs).toBe(83000);
    expect(BookmarkSchema.parse(base).startMs).toBeUndefined();
  });

  it("round-trips any valid note/tags idempotently", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(fc.string({ minLength: 1 }), { maxLength: 8 }),
        (note, tags) => {
          const once = BookmarkSchema.parse({ ...base, note, tags });
          const twice = BookmarkSchema.parse(once);
          expect(twice).toEqual(once);
        },
      ),
    );
  });

  it("rejects non-string tag entries", () => {
    const result = BookmarkSchema.safeParse({ ...base, tags: [1, 2] });
    expect(result.success).toBe(false);
  });
});
