import { z } from "zod";
import {
  LinkKind,
  ProbeConfigSchema,
  QuestionBlockSchema,
  QuestionType,
  StimulusSchema,
  SurveySectionSchema,
  TranscriptSegmentSchema,
  DashboardTileLayoutSchema,
  DashboardWidgetType,
  VisualAnalysisJobStatus,
} from "./entities.js";

// issueLivekitToken (§6.2)
export const IssueLivekitTokenRequestSchema = z.object({
  linkToken: z.string().min(1),
  alias: z.string().optional(),
});

export const SurveyMetaSchema = z.object({
  surveyId: z.string(),
  title: z.string(),
});

export const IssueLivekitTokenResponseSchema = z.object({
  sessionId: z.string(),
  livekitUrl: z.string(),
  token: z.string(),
  surveyMeta: SurveyMetaSchema,
  // Carries through whether this room was issued for a researcher-issued
  // test link (`test`) or a recruitment link (`production`). The interviewee
  // surface uses this to render a "test mode" indicator so a real interviewee
  // who accidentally received a test URL knows they are in a researcher's
  // self-test, not the live recruitment session.
  linkKind: LinkKind.default("production"),
});

// analyzeSession + AnalysisReport IO (§6.5)
export const AnalyzeSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
});

export const AnalyzeSessionResponseSchema = z.object({
  reportId: z.string(),
  scope: z.enum(["session", "survey"]),
});

// analyzeSurvey: rolls every existing AnalysisReport(scope=session) for one
// survey into a single AnalysisReport(scope=survey). Triggered by the agent
// worker on session completion (D1+D4) and by the researcher via the
// /reports/[surveyId] page (D5). Idempotent: same surveyId always upserts the
// same AnalysisReport(scope=survey) row.
export const AnalyzeSurveyRequestSchema = z.object({
  surveyId: z.string().min(1),
});

export const AnalyzeSurveyResponseSchema = z.object({
  reportId: z.string(),
  scope: z.literal("survey"),
});

export const DashboardWidgetCatalogEntrySchema = z.object({
  widgetType: DashboardWidgetType,
  groupId: z.string(),
  groupLabel: z.string(),
  label: z.string(),
  description: z.string(),
  defaultConfig: z.record(z.string(), z.unknown()).default({}),
  defaultLayout: DashboardTileLayoutSchema,
});

export const DashboardWidgetRunInputSchema = z.object({
  dashboardId: z.string().min(1),
  surveyId: z.string().min(1),
  tileIds: z.array(z.string().min(1)).max(50).optional(),
});

const StudyProgressWidgetResultSchema = z.object({
  totalSessions: z.number().int().nonnegative(),
  completedSessions: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(100),
});

const RecentSessionsWidgetResultSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      respondent: z.string(),
      state: z.string(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
    }),
  ),
});

const TopThemesWidgetResultSchema = z.object({
  themes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      mentions: z.number().int().nonnegative().optional(),
      pct: z.number().optional(),
      sentiment: z.string().optional(),
    }),
  ),
});

const TopInsightsWidgetResultSchema = z.object({
  insights: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      confidence: z.number().optional(),
    }),
  ),
});

const SentimentBreakdownWidgetResultSchema = z.object({
  sentimentBreakdown: z.array(
    z.object({
      sentiment: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

const BookmarkedQuotesWidgetResultSchema = z.object({
  bookmarks: z.array(
    z.object({
      id: z.string(),
      sessionId: z.string(),
      quote: z.string(),
      source: z.string(),
      respondent: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});

const VisualMomentsWidgetResultSchema = z.object({
  moments: z.array(
    z.object({
      sessionId: z.string(),
      timestampMs: z.number().int().nonnegative(),
      label: z.string(),
      description: z.string(),
    }),
  ),
});

const QuestionStatsWidgetResultSchema = z.object({
  questionStats: z.array(z.record(z.string(), z.unknown())),
});

export const DashboardWidgetResultSchema = z.discriminatedUnion("widgetType", [
  z.object({ widgetType: z.literal("study_progress"), result: StudyProgressWidgetResultSchema }),
  z.object({ widgetType: z.literal("recent_sessions"), result: RecentSessionsWidgetResultSchema }),
  z.object({ widgetType: z.literal("top_themes"), result: TopThemesWidgetResultSchema }),
  z.object({ widgetType: z.literal("top_insights"), result: TopInsightsWidgetResultSchema }),
  z.object({ widgetType: z.literal("sentiment_breakdown"), result: SentimentBreakdownWidgetResultSchema }),
  z.object({ widgetType: z.literal("bookmarked_quotes"), result: BookmarkedQuotesWidgetResultSchema }),
  z.object({ widgetType: z.literal("visual_moments"), result: VisualMomentsWidgetResultSchema }),
  z.object({ widgetType: z.literal("question_stats"), result: QuestionStatsWidgetResultSchema }),
]);

export const RunDashboardWidgetsOutputSchema = z.object({
  results: z.array(
    z.object({
      tileId: z.string(),
      widgetId: z.string(),
      widgetType: DashboardWidgetType,
      result: z.unknown().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export const StudyQuestionTypeSchema = z.enum([
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
]);

// Every question is probed; the only choice is how deep. `standard` probes
// 1-3 rounds, `deep` probes more (up to its maxRounds ceiling).
export const StudyProbeLevelSchema = z.enum(["standard", "deep"]);

export const SurveyDraftQuestionSchema = z
  .object({
    // `.trim()` 归一化前后空白后再 `.min(1)`,纯空白串(" ")会被裁成 "" 并拒绝。
    // 借鉴 PostHog CreateUserInterviewTopicTool 对 topic/questions 的 strip 处理。
    questionText: z.string().trim().min(1),
    questionType: StudyQuestionTypeSchema,
    probeLevel: StudyProbeLevelSchema.default("standard"),
    probeInstruction: z.string().trim().default(""),
    options: z.array(z.string().trim().min(1)).default([]),
    allowSkip: z.boolean().default(false),
    stimulus: StimulusSchema.optional(),
  })
  .superRefine((question, ctx) => {
    if (
      ["single_choice", "multi_choice", "ranking"].includes(question.questionType) &&
      question.options.length < 2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "choice-based questions require at least two options",
        path: ["options"],
      });
    }
  });

export const SurveyDraftSectionSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  questions: z.array(SurveyDraftQuestionSchema).min(1),
});

export const SurveyDraftSchema = z.object({
  title: z.string().trim().min(1),
  researchGoal: z.string().trim().min(1),
  targetAudience: z.string().trim().min(1),
  introScript: z.string().trim().min(1),
  // survey-editor moderator-instruction increment: researcher-authored directives
  // for the AI voice moderator (tone, pacing-as-behavior, interview style). The
  // interview GOAL is NOT duplicated here — it stays in `researchGoal`. Composed
  // into InterviewWorkflowConfig.supervisorInstruction at build time. Default ""
  // keeps existing drafts valid and means "use the operational default only".
  moderatorInstruction: z.string().trim().default(""),
  sections: z.array(SurveyDraftSectionSchema).min(1),
});

export const InterviewResponseModeSchema = z.enum([
  "voice_only",
  "single_select",
  "multi_select",
  "scale",
  "ranking",
]);

export const InterviewRuntimeQuestionSchema = z.object({
  questionId: z.string(),
  sectionId: z.string(),
  sectionTitle: z.string(),
  orderInSection: z.number().int().nonnegative(),
  questionText: z.string().min(1),
  questionType: StudyQuestionTypeSchema,
  probeLevel: StudyProbeLevelSchema,
  probeInstruction: z.string(),
  options: z.array(z.string().min(1)).default([]),
  responseMode: InterviewResponseModeSchema,
  stimulus: StimulusSchema.optional(),
});

export const InterviewRuntimeSectionSchema = z.object({
  sectionId: z.string(),
  title: z.string().min(1),
  objective: z.string().min(1),
  questions: z.array(InterviewRuntimeQuestionSchema).min(1),
});

export const InterviewRuntimeStudySchema = z.object({
  surveyId: z.string(),
  studyTitle: z.string().min(1),
  researchGoal: z.string().min(1),
  targetAudience: z.string().min(1),
  introScript: z.string().min(1),
  sections: z.array(InterviewRuntimeSectionSchema).min(1),
});

export const InterviewAnswerPayloadSchema = z.object({
  questionId: z.string(),
  sectionId: z.string(),
  questionType: StudyQuestionTypeSchema,
  source: z.enum(["voice", "ui", "mixed"]),
  text: z.string().default(""),
  selectedOptions: z.array(z.string()).default([]),
  score: z.number().optional(),
  ranking: z.array(z.string()).default([]),
});

export const InterviewAgentStatusSchema = z.enum([
  "idle",
  "ready",
  "collecting",
  "processing",
  "completed",
]);

export const InterviewAgentStateSchema = z.object({
  status: InterviewAgentStatusSchema,
  currentSectionId: z.string().optional(),
  currentQuestionId: z.string().optional(),
  currentQuestion: InterviewRuntimeQuestionSchema.optional(),
  updatedAt: z.string().datetime(),
});

export const InterviewRoomMetadataSchema = z.object({
  sessionId: z.string(),
  surveyId: z.string(),
  runtimeStudy: InterviewRuntimeStudySchema.optional(),
  workflowConfig: z.lazy(() => InterviewWorkflowConfigSchema).optional(),
});

export const SubmitInterviewAnswerRpcRequestSchema = z.object({
  answer: InterviewAnswerPayloadSchema,
});

export const SubmitInterviewAnswerRpcResponseSchema = z.object({
  ok: z.literal(true),
  nextQuestionId: z.string().optional(),
  completed: z.boolean(),
});

export const AnalysisReportInputSchema = z.object({
  sessionId: z.string(),
  survey: z.object({
    title: z.string(),
    flowConfig: z.record(z.string(), z.unknown()),
    sections: z.array(SurveySectionSchema),
    questionBlocks: z.array(QuestionBlockSchema),
  }),
  transcript: z.object({
    segments: z.array(TranscriptSegmentSchema),
  }),
  collectedAnswers: z.record(z.string(), z.unknown()),
});

export const QuestionTaskConfigSchema = z.object({
  questionId: z.string(),
  questionType: QuestionType,
  questionContent: z.string().min(1),
  probeConfig: ProbeConfigSchema.optional(),
  stimulus: StimulusSchema.optional(),
});

export const SectionTaskGroupConfigSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  sectionInstruction: z.string().optional(),
  questions: z.array(QuestionTaskConfigSchema).min(1),
});

export const InterviewWorkflowConfigSchema = z.object({
  surveyId: z.string(),
  sessionId: z.string(),
  supervisorInstruction: z.string().min(1),
  sections: z.array(SectionTaskGroupConfigSchema).min(1),
});

// A single probe exchange: the AI's follow-up question and the answer to it.
export const ProbeRoundSchema = z.object({
  probeQuestion: z.string(),
  respondentAnswer: z.string(),
});

// Every question is probed at least once. `rounds` holds each probe exchange,
// capped at the question's maxRounds ceiling. The AI may stop earlier.
export const ProbeResultSchema = z.object({
  level: z.enum(["standard", "deep"]),
  probeInstruction: z.string(),
  rounds: z.array(ProbeRoundSchema).min(1),
});

export const QuestionTaskResultSchema = z.object({
  questionType: QuestionType,
  questionContent: z.string(),
  respondentAnswer: z.string(),
  probe: ProbeResultSchema.nullable(),
});

export const SectionTaskGroupResultSchema = z.object({
  sectionId: z.string(),
  questionResults: z.record(z.string(), QuestionTaskResultSchema),
});

export const BuildInterviewRuntimeStudyInputSchema = z.object({
  surveyId: z.string().min(1),
  draft: SurveyDraftSchema,
});

export const BuildInterviewWorkflowConfigInputSchema = z.object({
  surveyId: z.string().min(1),
  sessionId: z.string().min(1),
  draft: SurveyDraftSchema,
  supervisorInstruction: z.string().min(1).optional(),
});

export const BuildInterviewRoomMetadataInputSchema = z.object({
  surveyId: z.string().min(1),
  sessionId: z.string().min(1),
  draft: SurveyDraftSchema,
  supervisorInstruction: z.string().min(1).optional(),
});

const SegmentRefSchema = z.object({
  transcriptId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
});

/**
 * Generation metadata recorded alongside every v2 AnalysisReport (session or
 * survey). Lets us know "which prompt version produced this, how many LLM
 * attempts it took, what hallucination ratio passed it through, and what
 * model+token usage each stage consumed".
 *
 * See `.kiro/specs/analysis-report-v2/design.md` §4.2. The field is optional
 * so historic v1 reports keep parsing without backfill (D12).
 */
export const GenerationMetaSchema = z
  .object({
    promptVersion: z.string(),
    attemptCount: z.number().int().nonnegative(),
    hallucinationRatio: z.number().min(0).max(1),
    createdWith: z.array(
      z.object({
        stage: z.string(),
        model: z.string(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      }),
    ),
  })
  .passthrough();
export type GenerationMeta = z.infer<typeof GenerationMetaSchema>;

export const VisualAnalysisSegmentSchema = z.object({
  id: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  evidence: z.array(SegmentRefSchema).default([]),
  observations: z.array(z.string()).default([]),
  issueLevel: z.enum(["none", "minor", "major"]).default("none"),
});

export const VisualAnalysisMomentSchema = z.object({
  id: z.string(),
  timestampMs: z.number().int().nonnegative(),
  label: z.string(),
  description: z.string(),
  segmentId: z.string().optional(),
});

// Interview-specific frustration signals (PostHog session_summary sentiment
// signals borrowed and renamed for the voice-interview domain per scope.md —
// no screen-click signals like rage_click/dead_click).
export const VisualSentimentSignalSchema = z.object({
  signalType: z.enum([
    "long_pause",
    "hesitation",
    "backtracking",
    "confusion",
    "repeated_question",
    "abandonment",
    "frustration_expressed",
    "other",
  ]),
  segmentIndex: z.number().int().nonnegative(),
  description: z.string(),
  intensity: z.number().min(0).max(1),
});

export const VISUAL_ANALYSIS_OUTCOMES = ["successful", "friction", "frustrated", "blocked"] as const;

// Fixed tag taxonomy for interview sessions (PostHog AI_TAGS_FIXED_TAXONOMY
// borrowed + renamed for the voice-interview domain per scope.md). No
// team-custom taxonomy — teams are out of scope.
export const VISUAL_TAG_TAXONOMY: Record<string, string> = {
  engaged: "Interviewee is attentive, elaborates, answers readily",
  hesitation: "Noticeable pauses, uncertainty, or trailing-off before answering",
  confusion: "Misunderstands a question, asks for clarification, or backtracks",
  frustration: "Visible irritation, terse answers, or complaints",
  disengagement: "Distracted, minimal answers, looking away, wanting to end",
  stimulus_reaction: "A clear reaction (positive or negative) to a shown stimulus",
  strong_opinion: "Expresses a strong like/dislike or memorable, quotable view",
  storytelling: "Shares a concrete personal anecdote or detailed scenario",
  technical_issue: "Audio/video/connection problem visibly affected the session",
  off_topic: "Sustained drift away from the interview questions",
};

export const VisualAnalysisOutputSchema = z.object({
  source: z.literal("recording"),
  recordingFileId: z.string(),
  durationMs: z.number().int().nonnegative(),
  visualConfirmation: z.boolean(),
  segments: z.array(VisualAnalysisSegmentSchema),
  keyMoments: z.array(VisualAnalysisMomentSchema),
  summary: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]).default("neutral"),
  // Numeric frustration model (ADR 0005 Gap D, PostHog parity). 0=smooth, 1=severe.
  frustrationScore: z.number().min(0).max(1).default(0),
  outcome: z.enum(VISUAL_ANALYSIS_OUTCOMES).default("successful"),
  sentimentSignals: z.array(VisualSentimentSignalSchema).default([]),
  // Free tags (legacy) + fixed-taxonomy + freeform tags + highlight (Gap E).
  tags: z.array(z.string()).default([]),
  tagsFixed: z.array(z.string()).default([]),
  tagsFreeform: z.array(z.string()).default([]),
  // True only when a human should watch this session (something notable/broken).
  highlighted: z.boolean().default(false),
  modelId: z.string().optional(),
  generatedAt: z.string().datetime().optional(),
});

export const AnalysisReportOutputSchema = z.object({
  scope: z.literal("session"),
  themes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      // P-ANL-01: every theme must carry at least one transcript evidence ref
      // so reviewers can audit provenance.
      evidence: z.array(SegmentRefSchema).min(1),
    }),
  ),
  insights: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      supportingThemes: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
  citations: z.array(
    z.object({
      segmentRef: SegmentRefSchema,
      quote: z.string(),
      themeIds: z.array(z.string()),
    }),
  ),
  perQuestionSummary: z.array(
    z.object({
      questionId: z.string(),
      summary: z.string(),
      sentiment: z.string(),
    }),
  ),
  rendered: z
    .object({
      storageFileId: z.string(),
      format: z.string(),
    })
    .nullable(),
  visualAnalysis: VisualAnalysisOutputSchema.nullable().optional(),
  generationMeta: GenerationMetaSchema.optional(),
});

/**
 * Survey-level rolled-up report — the output of `analyzeSurvey`.
 *
 * Distinct from `AnalysisReportOutputSchema` (session-level, single transcript)
 * because survey-level rolls many sessions into question-level aggregate
 * statistics (choice / rating / nps), a single themes/insights set, and
 * preserves citations that map back to specific transcript segments.
 *
 * Field semantics:
 * - `totalRespondents` and `completedRespondents` may diverge once we model
 *   abandoned sessions (P-ANL-03 today asserts completedRespondents equals the
 *   number of session-level reports for this survey).
 * - `themes[].pct` is share of mentions across all sessions; `themes` sum is
 *   constrained to <= 1.0 by P-ANL-04 to catch LLM hallucinated over-coverage.
 * - `rendered` is nullable: PDF/Markdown export is out of scope for v1
 *   (ADR-0003 §Out of scope), so the field is always `null` until that lands.
 */
const SurveySegmentRefSchema = z.object({
  transcriptId: z.string(),
  segmentIndex: z.number().int().nonnegative(),
});

const SurveyChoiceDatumSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
  blurb: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

const SurveyRatingDatumSchema = z.object({
  score: z.number().int(),
  count: z.number().int().nonnegative(),
});

const SurveySentimentDatumSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  count: z.number().int().nonnegative(),
});

const SurveyChoiceQuestionStatSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  kind: z.literal("choice"),
  multi: z.boolean(),
  total: z.number().int().nonnegative(),
  reportQuestion: z.string(),
  summary: z.string(),
  data: z.array(SurveyChoiceDatumSchema),
});

const SurveyRatingQuestionStatSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  kind: z.literal("rating"),
  total: z.number().int().nonnegative(),
  average: z.number(),
  scaleMax: z.number().int().positive(),
  reportQuestion: z.string(),
  summary: z.string(),
  data: z.array(SurveyRatingDatumSchema),
});

const SurveyNpsQuestionStatSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  kind: z.literal("nps"),
  total: z.number().int().nonnegative(),
  score: z.number().min(-100).max(100),
  promoters: z.number().int().nonnegative(),
  passives: z.number().int().nonnegative(),
  detractors: z.number().int().nonnegative(),
  reportQuestion: z.string(),
  summary: z.string(),
});

export const SurveyQuestionStatSchema = z.discriminatedUnion("kind", [
  SurveyChoiceQuestionStatSchema,
  SurveyRatingQuestionStatSchema,
  SurveyNpsQuestionStatSchema,
]);

const SurveyThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  mentions: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

const SurveyInsightItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

const SurveyCitationSchema = z.object({
  segmentRef: SurveySegmentRefSchema,
  quote: z.string(),
  themeIds: z.array(z.string()),
});

export const SurveyAnalysisReportOutputSchema = z.object({
  surveyId: z.string(),
  surveyTitle: z.string(),
  totalRespondents: z.number().int().nonnegative(),
  completedRespondents: z.number().int().nonnegative(),
  avgDurationLabel: z.string(),
  studyCount: z.number().int().nonnegative().optional(),
  lastUpdatedLabel: z.string(),
  topics: z.array(z.string()),
  questionStats: z.array(SurveyQuestionStatSchema),
  sentimentBreakdown: z.array(SurveySentimentDatumSchema),
  themes: z.array(SurveyThemeSchema),
  insights: z.array(SurveyInsightItemSchema),
  citations: z.array(SurveyCitationSchema),
  rendered: z
    .object({
      storageFileId: z.string(),
      format: z.string(),
    })
    .nullable(),
  generationMeta: GenerationMetaSchema.optional(),
});

export const INTERVIEW_STATE_ATTRIBUTE = "merism.interviewState";
export const SUBMIT_ANSWER_RPC_METHOD = "merism.submit_answer";

const QUESTION_TYPE_TO_RESPONSE_MODE: Record<
  z.infer<typeof StudyQuestionTypeSchema>,
  z.infer<typeof InterviewResponseModeSchema>
> = {
  open_ended: "voice_only",
  single_choice: "single_select",
  multi_choice: "multi_select",
  rating: "scale",
  nps: "scale",
  ranking: "ranking",
};

// Default round ceilings per depth. These are starting points; the authoritative
// control is the maxRounds number itself, which a researcher can fine-tune.
const PROBE_DEFAULT_MAX_ROUNDS = {
  standard: 3,
  deep: 5,
} as const;

// Every question is probed, so this always returns a config (never undefined).
function mapProbeLevelToProbeConfig(
  probeLevel: z.infer<typeof StudyProbeLevelSchema>,
  probeInstruction: string,
) {
  return {
    level: probeLevel,
    instruction: probeInstruction,
    maxRounds: PROBE_DEFAULT_MAX_ROUNDS[probeLevel],
  } as const;
}

export function buildInterviewRuntimeStudy(input: BuildInterviewRuntimeStudyInput): InterviewRuntimeStudy {
  const { surveyId, draft } = BuildInterviewRuntimeStudyInputSchema.parse(input);

  return InterviewRuntimeStudySchema.parse({
    surveyId,
    studyTitle: draft.title,
    researchGoal: draft.researchGoal,
    targetAudience: draft.targetAudience,
    introScript: draft.introScript,
    sections: draft.sections.map((section, sectionIndex) => {
      const sectionId = `section-${sectionIndex + 1}`;

      return {
        sectionId,
        title: section.title,
        objective: section.objective,
        questions: section.questions.map((question, questionIndex) => ({
          questionId: `question-${sectionIndex + 1}-${questionIndex + 1}`,
          sectionId,
          sectionTitle: section.title,
          orderInSection: questionIndex,
          questionText: question.questionText,
          questionType: question.questionType,
          probeLevel: question.probeLevel,
          probeInstruction: question.probeInstruction,
          options: question.options,
          responseMode: QUESTION_TYPE_TO_RESPONSE_MODE[question.questionType],
          stimulus: question.stimulus,
        })),
      };
    }),
  });
}

export function buildInterviewWorkflowConfigFromDraft(
  input: BuildInterviewWorkflowConfigInput,
): InterviewWorkflowConfig {
  const { surveyId, sessionId, draft, supervisorInstruction } =
    BuildInterviewWorkflowConfigInputSchema.parse(input);
  const runtimeStudy = buildInterviewRuntimeStudy({ surveyId, draft });

  // Operational base: how to run the interview (section order, probes). Stable.
  const operationalInstruction = `Guide a qualitative interview for "${runtimeStudy.studyTitle}". Use the intro script, follow the section order, and use probe instructions when configured.`;
  // Moderator persona/delivery (tone, pacing-as-behavior, style) authored by the
  // researcher on the survey. Prepended so it frames the whole interview; the
  // operational base still follows. An explicit `supervisorInstruction` arg wins
  // outright (used by callers that already composed their own).
  const moderator = draft.moderatorInstruction?.trim();
  const composedInstruction = moderator
    ? `${moderator}\n\n${operationalInstruction}`
    : operationalInstruction;

  return InterviewWorkflowConfigSchema.parse({
    surveyId,
    sessionId,
    supervisorInstruction: supervisorInstruction ?? composedInstruction,
    sections: runtimeStudy.sections.map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      description: section.objective,
      sectionInstruction: section.objective,
      questions: section.questions.map((question) => ({
        questionId: question.questionId,
        questionType: question.questionType,
        questionContent: question.questionText,
        probeConfig: mapProbeLevelToProbeConfig(
          question.probeLevel,
          question.probeInstruction,
        ),
      })),
    })),
  });
}

export function buildInterviewRoomMetadataFromDraft(
  input: BuildInterviewRoomMetadataInput,
): InterviewRoomMetadata {
  const { surveyId, sessionId, draft, supervisorInstruction } =
    BuildInterviewRoomMetadataInputSchema.parse(input);
  const runtimeStudy = buildInterviewRuntimeStudy({ surveyId, draft });
  const workflowConfig = buildInterviewWorkflowConfigFromDraft({
    surveyId,
    sessionId,
    draft,
    supervisorInstruction,
  });

  return InterviewRoomMetadataSchema.parse({
    sessionId,
    surveyId,
    runtimeStudy,
    workflowConfig,
  });
}

export type IssueLivekitTokenRequest = z.infer<typeof IssueLivekitTokenRequestSchema>;
export type IssueLivekitTokenResponse = z.infer<typeof IssueLivekitTokenResponseSchema>;
export type AnalyzeSessionRequest = z.infer<typeof AnalyzeSessionRequestSchema>;
export type AnalyzeSessionResponse = z.infer<typeof AnalyzeSessionResponseSchema>;
export type StudyQuestionType = z.infer<typeof StudyQuestionTypeSchema>;
export type StudyProbeLevel = z.infer<typeof StudyProbeLevelSchema>;
export type SurveyDraftQuestion = z.infer<typeof SurveyDraftQuestionSchema>;
export type SurveyDraftSection = z.infer<typeof SurveyDraftSectionSchema>;
export type SurveyDraft = z.infer<typeof SurveyDraftSchema>;
export type InterviewResponseMode = z.infer<typeof InterviewResponseModeSchema>;
export type InterviewRuntimeQuestion = z.infer<typeof InterviewRuntimeQuestionSchema>;
export type InterviewRuntimeSection = z.infer<typeof InterviewRuntimeSectionSchema>;
export type InterviewRuntimeStudy = z.infer<typeof InterviewRuntimeStudySchema>;
export type InterviewAnswerPayload = z.infer<typeof InterviewAnswerPayloadSchema>;
export type InterviewAgentStatus = z.infer<typeof InterviewAgentStatusSchema>;
export type InterviewAgentState = z.infer<typeof InterviewAgentStateSchema>;
export type InterviewRoomMetadata = z.infer<typeof InterviewRoomMetadataSchema>;
export type SubmitInterviewAnswerRpcRequest = z.infer<
  typeof SubmitInterviewAnswerRpcRequestSchema
>;
export type SubmitInterviewAnswerRpcResponse = z.infer<
  typeof SubmitInterviewAnswerRpcResponseSchema
>;
export type BuildInterviewRuntimeStudyInput = z.infer<typeof BuildInterviewRuntimeStudyInputSchema>;
export type BuildInterviewWorkflowConfigInput = z.infer<typeof BuildInterviewWorkflowConfigInputSchema>;
export type BuildInterviewRoomMetadataInput = z.infer<
  typeof BuildInterviewRoomMetadataInputSchema
>;
export type AnalysisReportInput = z.infer<typeof AnalysisReportInputSchema>;
export type AnalysisReportOutput = z.infer<typeof AnalysisReportOutputSchema>;
export type VisualAnalysisOutput = z.infer<typeof VisualAnalysisOutputSchema>;
export type QuestionTaskConfig = z.infer<typeof QuestionTaskConfigSchema>;
export type SectionTaskGroupConfig = z.infer<typeof SectionTaskGroupConfigSchema>;
export type InterviewWorkflowConfig = z.infer<typeof InterviewWorkflowConfigSchema>;
export type ProbeRound = z.infer<typeof ProbeRoundSchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
export type QuestionTaskResult = z.infer<typeof QuestionTaskResultSchema>;
export type SectionTaskGroupResult = z.infer<typeof SectionTaskGroupResultSchema>;
export type AnalyzeSurveyRequest = z.infer<typeof AnalyzeSurveyRequestSchema>;
export type AnalyzeSurveyResponse = z.infer<typeof AnalyzeSurveyResponseSchema>;
export type DashboardWidgetCatalogEntry = z.infer<typeof DashboardWidgetCatalogEntrySchema>;
export type DashboardWidgetRunInput = z.infer<typeof DashboardWidgetRunInputSchema>;
export type DashboardWidgetResult = z.infer<typeof DashboardWidgetResultSchema>;
export type RunDashboardWidgetsOutput = z.infer<typeof RunDashboardWidgetsOutputSchema>;
export type SurveyQuestionStat = z.infer<typeof SurveyQuestionStatSchema>;
export type SurveyAnalysisReportOutput = z.infer<typeof SurveyAnalysisReportOutputSchema>;


// ============================================================================
// notebooks sub-spec — Wave B contracts (R4 createNotebook + R5 searchAcrossNotebooks)
// 见 .kiro/specs/notebooks/design.md §4.2.
// ============================================================================

/**
 * Morris createNotebook 工具的入参契约。
 *
 * D10 决策: 永远 create 新 Notebook, 不存在 update existing 路径; 故不引入
 * `existingNotebookShortId` / `artifact_id` 等 PostHog tool 中的更新参数。
 * 研究员不满意时让 Morris 重新生成新一份。
 *
 * `content` 与 `draftContent` 互斥(借 PostHog `CreateNotebookToolArgs` 的 mutex):
 * - `content`: Markdown 字符串, 立即流式给用户看 (R4.1 主路径)
 * - `draftContent`: AI 内部"先想再写"草稿, 不流式展示, Wave D 备用
 */
export const CreateNotebookRequestSchema = z
  .object({
    studyId: z.string(),
    question: z.string().min(1).max(2_000),
    content: z.string().max(100_000).optional(),
    draftContent: z.string().max(100_000).optional(),
  })
  .refine(
    (v) => (v.content !== undefined) !== (v.draftContent !== undefined),
    { message: "content 与 draftContent 必须二选一 (互斥)" },
  );

export const CreateNotebookResponseSchema = z.object({
  notebookShortId: z.string().regex(/^[a-z0-9]{12}$/),
  // status 永远是 "created" (D10 无 update 路径), 字段保留是为未来扩展不破坏 API
  status: z.literal("created"),
  sectionCount: z.number().int().nonnegative(),
});

export type CreateNotebookRequest = z.infer<typeof CreateNotebookRequestSchema>;
export type CreateNotebookResponse = z.infer<typeof CreateNotebookResponseSchema>;

/**
 * Morris searchAcrossStudies 工具的入参契约 (R5)。
 *
 * 实现路径 (Wave E 落地):
 * 1. 调 Qwen DashScope text-embedding-v3 把 query 转 1024 维向量
 * 2. 拉 owner 全部 notebook 的 (shortId, embedding) 列表 (Query.select 投影只拉精简列)
 * 3. brute-force cosine 计算 → top N 排序
 *
 * 当 owner 级 Notebook 数 > EMBEDDING_BRUTEFORCE_LIMIT(=100) 时 Function 自动
 * fallback 为 `Query.search("textContent", query)` fulltext, 返回时 `fallback`
 * 字段标 `"scale-fulltext-only"`。embedding API 失败时也 fallback 为 fulltext,
 * 字段标 `"embedding-error"`。见 design §9.2 + R5.4。
 */
export const SearchAcrossNotebooksRequestSchema = z.object({
  query: z.string().min(1).max(500),
  ownerUserId: z.string(),
  // 限定到某 study; 不传则跨所有 study
  studyId: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export const SearchAcrossNotebooksResponseSchema = z.object({
  matches: z.array(
    z.object({
      notebookShortId: z.string(),
      studyId: z.string(),
      studyTitle: z.string(),
      headline: z.string(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
  fallback: z.enum(["scale-fulltext-only", "embedding-error"]).optional(),
});

export type SearchAcrossNotebooksRequest = z.infer<typeof SearchAcrossNotebooksRequestSchema>;
export type SearchAcrossNotebooksResponse = z.infer<typeof SearchAcrossNotebooksResponseSchema>;

// analyzeSessionVisual: async post-session Gemini visual pipeline (ADR 0005 D1).
// Enqueued by analyzeSession after the text report is persisted; runs the
// upload -> per-segment -> consolidation pass off the request path and patches
// `visualAnalysis` back into the AnalysisReport(scope=session) row.
export const AnalyzeSessionVisualRequestSchema = z.object({
  sessionId: z.string().min(1),
});

export const AnalyzeSessionVisualResponseSchema = z.object({
  jobId: z.string(),
  status: VisualAnalysisJobStatus,
  // true when this invocation claimed the job; false when a concurrent run
  // already claimed it (the 409-CAS dedup loser, ADR 0005 D3).
  claimed: z.boolean(),
});

export type AnalyzeSessionVisualRequest = z.infer<typeof AnalyzeSessionVisualRequestSchema>;
export type AnalyzeSessionVisualResponse = z.infer<typeof AnalyzeSessionVisualResponseSchema>;

export type VisualSentimentSignal = z.infer<typeof VisualSentimentSignalSchema>;
