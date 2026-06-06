import { z } from "zod";
import {
  ProbeConfigSchema,
  QuestionBlockSchema,
  QuestionType,
  StimulusSchema,
  SurveySectionSchema,
  TranscriptSegmentSchema,
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
    questionText: z.string().min(1),
    questionType: StudyQuestionTypeSchema,
    probeLevel: StudyProbeLevelSchema.default("standard"),
    probeInstruction: z.string().default(""),
    options: z.array(z.string().min(1)).default([]),
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
  title: z.string().min(1),
  objective: z.string().min(1),
  questions: z.array(SurveyDraftQuestionSchema).min(1),
});

export const SurveyDraftSchema = z.object({
  title: z.string().min(1),
  researchGoal: z.string().min(1),
  targetAudience: z.string().min(1),
  introScript: z.string().min(1),
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

  return InterviewWorkflowConfigSchema.parse({
    surveyId,
    sessionId,
    supervisorInstruction:
      supervisorInstruction ??
      `Guide a qualitative interview for "${runtimeStudy.studyTitle}". Use the intro script, follow the section order, and use probe instructions when configured.`,
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
export type QuestionTaskConfig = z.infer<typeof QuestionTaskConfigSchema>;
export type SectionTaskGroupConfig = z.infer<typeof SectionTaskGroupConfigSchema>;
export type InterviewWorkflowConfig = z.infer<typeof InterviewWorkflowConfigSchema>;
export type ProbeRound = z.infer<typeof ProbeRoundSchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
export type QuestionTaskResult = z.infer<typeof QuestionTaskResultSchema>;
export type SectionTaskGroupResult = z.infer<typeof SectionTaskGroupResultSchema>;
export type AnalyzeSurveyRequest = z.infer<typeof AnalyzeSurveyRequestSchema>;
export type AnalyzeSurveyResponse = z.infer<typeof AnalyzeSurveyResponseSchema>;
export type SurveyQuestionStat = z.infer<typeof SurveyQuestionStatSchema>;
export type SurveyAnalysisReportOutput = z.infer<typeof SurveyAnalysisReportOutputSchema>;
