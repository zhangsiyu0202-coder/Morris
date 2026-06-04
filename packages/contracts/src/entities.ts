import { z } from "zod";

// Reusable json field (Appwrite stores as stringified json / object attr)
const json = z.record(z.string(), z.unknown());

export const SurveyStatus = z.enum(["draft", "published", "archived"]);
export const QuestionType = z.enum([
  "text",
  "open_ended",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
  "ranking",
  "info",
]);
export const LinkMode = z.enum(["single_use", "reusable"]);
export const SessionState = z.enum([
  "created",
  "in_progress",
  "completed",
  "abandoned",
  "failed",
]);
export const RecordingFormat = z.enum(["mp3", "opus", "wav"]);
export const ReportScope = z.enum(["session", "survey"]);

export const UserSchema = z.object({
  $id: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string().datetime(),
});

export const ProjectSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  createdAt: z.string().datetime(),
});

export const SurveySchema = z.object({
  $id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: SurveyStatus.default("draft"),
  flowConfig: json.default({}),
  version: z.number().int().nonnegative().default(1),
  updatedAt: z.string().datetime(),
});

export const SurveySectionSchema = z.object({
  $id: z.string(),
  surveyId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  order: z.number().int().nonnegative(),
  supervisorInstruction: z.string().optional(),
  sectionInstruction: z.string().optional(),
});

export const ProbeLevel = z.enum(["standard", "deep"]);

export const ProbeConfigSchema = z.object({
  level: ProbeLevel,
  // Free-form guidance handed to the LLM. Empty means "no specific guidance —
  // probe at your own discretion".
  instruction: z.string().default(""),
  // Hard ceiling on probe rounds. The agent may stop earlier; it must never
  // exceed this. standard defaults to 3, deep to 5.
  maxRounds: z.number().int().positive().default(3),
});

export const StimulusType = z.enum(["image", "video", "text"]);

export const StimulusSchema = z.object({
  id: z.string(),
  type: StimulusType,
  url: z.string().url().optional(),
  text: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
});

export const QuestionBlockSchema = z.object({
  $id: z.string(),
  surveyId: z.string(),
  sectionId: z.string(),
  order: z.number().int().nonnegative(),
  orderInSection: z.number().int().nonnegative(),
  type: QuestionType,
  prompt: z.string(),
  config: json.default({}),
  probeConfig: ProbeConfigSchema.optional(),
  stimulus: StimulusSchema.optional(),
  probingPolicy: json.default({}),
  skipLogic: json.default({}),
});

export const InterviewLinkSchema = z.object({
  $id: z.string(),
  surveyId: z.string(),
  token: z.string(),
  mode: LinkMode,
  maxUses: z.number().int().positive(),
  usedCount: z.number().int().nonnegative().default(0),
  expiresAt: z.string().datetime(),
});

export const TranscriptSegmentSchema = z.object({
  speaker: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});

export const InterviewSessionSchema = z.object({
  $id: z.string(),
  surveyId: z.string(),
  linkId: z.string(),
  intervieweeAlias: z.string().optional(),
  state: SessionState.default("created"),
  livekitRoom: z.string(),
  collectedAnswers: json.default({}),
  errorContext: json.optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

export const TranscriptSchema = z.object({
  $id: z.string(),
  sessionId: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  language: z.string(),
  finalizedAt: z.string().datetime(),
});

export const RecordingSchema = z.object({
  $id: z.string(),
  sessionId: z.string(),
  storageFileId: z.string(),
  durationMs: z.number().int().nonnegative(),
  format: RecordingFormat,
});

export const AnalysisReportSchema = z.object({
  $id: z.string(),
  sessionId: z.string(),
  surveyId: z.string().optional(),
  scope: ReportScope,
  themes: z.array(z.unknown()).default([]),
  insights: z.array(z.unknown()).default([]),
  citations: z.array(z.unknown()).default([]),
  storageFileId: z.string().optional(),
  generatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Survey = z.infer<typeof SurveySchema>;
export type SurveySection = z.infer<typeof SurveySectionSchema>;
export type ProbeLevel = z.infer<typeof ProbeLevel>;
export type ProbeConfig = z.infer<typeof ProbeConfigSchema>;
export type StimulusType = z.infer<typeof StimulusType>;
export type Stimulus = z.infer<typeof StimulusSchema>;
export type QuestionBlock = z.infer<typeof QuestionBlockSchema>;
export type InterviewLink = z.infer<typeof InterviewLinkSchema>;
export type InterviewSession = z.infer<typeof InterviewSessionSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
