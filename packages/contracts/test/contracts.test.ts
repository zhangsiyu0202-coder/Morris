import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  AnalysisReportSchema,
  buildInterviewRoomMetadataFromDraft,
  buildInterviewRuntimeStudy,
  buildInterviewWorkflowConfigFromDraft,
  canTransitionSurveyStatus,
  InsightSchema,
  RecordingFormat,
  InterviewWorkflowConfigSchema,
  IssueLivekitTokenRequestSchema,
  InterviewLinkSchema,
  QuestionTaskResultSchema,
  SurveyAnalysisReportOutputSchema,
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
    expect(InterviewLinkSchema.safeParse({ ...link, maxUses: 0 }).success).toBe(false);
  });
});

describe("contracts: LiveKit interview workflow", () => {
  it("models survey sections as task groups and questions as tasks", () => {
    const workflow = InterviewWorkflowConfigSchema.parse({
      surveyId: "sv1",
      sessionId: "sess1",
      supervisorInstruction: "Guide the interview with a calm research tone.",
      sections: [
        {
          sectionId: "sec1",
          title: "Concept reaction",
          questions: [
            {
              questionId: "q1",
              questionType: "text",
              questionContent: "What is your first reaction?",
              probeConfig: {
                level: "standard",
                instruction: "Ask one or two natural follow-ups if the answer is thin.",
                maxRounds: 2,
              },
            },
          ],
        },
      ],
    });

    expect(workflow.sections[0]?.questions[0]?.probeConfig?.level).toBe("standard");
  });

  it("keeps question task results minimal", () => {
    const result = QuestionTaskResultSchema.parse({
      questionType: "single_choice",
      questionContent: "Which option do you prefer?",
      respondentAnswer: "Option A, because it feels clearer.",
      probe: null,
    });

    expect(result.probe).toBeNull();
  });
});

describe("contracts: survey draft shape", () => {
  it("accepts a qualitative interview draft", () => {
    const draft = SurveyDraftSchema.parse({
      title: "Coffee subscription onboarding research",
      researchGoal: "Understand how new subscribers evaluate coffee delivery services.",
      targetAudience: "People who subscribed to a coffee delivery service in the last 3 months.",
      introScript: "Thanks for joining. I want to learn about your recent experience.",
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

  it("rejects choice questions without enough options", () => {
    expect(
      SurveyDraftSchema.safeParse({
        title: "Bad draft",
        researchGoal: "Test validation.",
        targetAudience: "Anyone.",
        introScript: "Hello.",
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
        researchGoal: "Understand reactions to a new concept.",
        targetAudience: "Existing customers.",
        introScript: "Thanks for joining this interview.",
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

  it("maps a study draft to a workflow config for the LiveKit agent", () => {
    const workflow = buildInterviewWorkflowConfigFromDraft({
      surveyId: "survey-1",
      sessionId: "session-1",
      draft: SurveyDraftSchema.parse({
        title: "Onboarding study",
        researchGoal: "Learn about onboarding friction.",
        targetAudience: "New users.",
        introScript: "Thanks for speaking with me today.",
        sections: [
          {
            title: "Opening",
            objective: "Get orientation and context.",
            questions: [
              {
                questionText: "Tell me about your first week using the product.",
                questionType: "open_ended",
                probeLevel: "deep",
                probeInstruction: "Ask what surprised them and what blocked them.",
              },
            ],
          },
        ],
      }),
    });

    expect(workflow.sections[0]?.questions[0]?.probeConfig?.level).toBe("deep");
    expect(workflow.sections[0]?.questions[0]?.questionContent).toContain("first week");
  });

  it("builds room metadata that bundles runtime and workflow state", () => {
    const metadata = buildInterviewRoomMetadataFromDraft({
      surveyId: "survey-1",
      sessionId: "session-1",
      draft: SurveyDraftSchema.parse({
        title: "Retention study",
        researchGoal: "Understand what keeps users active.",
        targetAudience: "Recently activated users.",
        introScript: "Thanks for talking with me today.",
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
    expect(metadata.workflowConfig?.sections[0]?.questions[0]?.questionId).toBe("question-1-1");
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
      generatedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts scope=survey with surveyId and no sessionId", () => {
    const result = AnalysisReportSchema.safeParse({
      $id: "r5",
      surveyId: "sv1",
      scope: "survey",
      generatedAt: "2026-06-06T00:00:00.000Z",
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

describe("contracts: Insight entity (ADR-0003 D2)", () => {
  it("accepts a fully-populated insight", () => {
    const insight = InsightSchema.parse({
      $id: "i1",
      studyId: "st1",
      studyTitle: "S",
      question: "Why did people churn?",
      headline: "Pricing is the leading driver",
      summary: "Direct answer",
      confidence: "high",
      sampleSize: 12,
      ownerUserId: "u1",
      createdAt: "2026-06-06T00:00:00.000Z",
      report: {
        headline: "Pricing is the leading driver",
        directAnswer: "Multiple respondents cited the new tier.",
        confidence: "high",
        confidenceReason: "12/15 quotes mention pricing.",
        themes: [{ title: "Pricing", analysis: "...", quotes: ["..."] }],
        divergences: [{ group: "power users", stance: "value-based" }],
        actions: [{ priority: "P0", action: "...", rationale: "..." }],
      },
    });
    expect(insight.confidence).toBe("high");
    expect(insight.report.actions[0]?.priority).toBe("P0");
  });
});
