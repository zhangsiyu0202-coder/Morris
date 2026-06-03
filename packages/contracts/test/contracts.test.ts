import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildInterviewRoomMetadataFromDraft,
  buildInterviewRuntimeStudy,
  buildInterviewWorkflowConfigFromDraft,
  InterviewWorkflowConfigSchema,
  IssueLivekitTokenRequestSchema,
  InterviewLinkSchema,
  QuestionTaskResultSchema,
  SurveyDraftSchema,
} from "@merism/contracts";

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
                level: "medium",
                instruction: "Ask one or two natural follow-ups if the answer is thin.",
                maxRounds: 2,
              },
            },
          ],
        },
      ],
    });

    expect(workflow.sections[0]?.questions[0]?.probeConfig?.level).toBe("medium");
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
              probeLevel: "follow_up",
              probeInstruction: "Ask for context, decision factors, and any friction in the journey.",
            },
          ],
        },
      ],
    });

    expect(draft.sections[0]?.questions[0]?.probeLevel).toBe("follow_up");
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
                probeLevel: "none",
                options: ["Only option"],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects missing probe instructions when probing is enabled", () => {
    expect(
      SurveyDraftSchema.safeParse({
        title: "Probe validation",
        researchGoal: "Check probe rules.",
        targetAudience: "Researchers.",
        introScript: "Hello.",
        sections: [
          {
            title: "Section 1",
            objective: "Collect detail.",
            questions: [
              {
                questionText: "Describe your workflow.",
                questionType: "open_ended",
                probeLevel: "deep",
                probeInstruction: "",
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
                probeLevel: "follow_up",
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
                probeLevel: "follow_up",
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
