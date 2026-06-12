import { z } from "zod";

// Reusable json field (Appwrite stores as stringified json / object attr)
const json = z.record(z.string(), z.unknown());

// --- ADR 0006 (workspaces-billing) tenancy fields ---------------------------
// `workspaceId` is the tenant key (an Appwrite Team id); `authorId` is the
// creating researcher (the recast of `ownerUserId`, which is kept + read during
// the M2 migration rollout per the contracts.md deprecation pattern). Both are
// OPTIONAL until the migration backfills every row; a later slice tightens them
// to required. Anonymous-interviewee rows carry workspaceId (denormalized for
// tenant-scoped permissions) but no authorId. See docs/adr/0006.

export const SurveyStatus = z.enum(["draft", "published", "paused", "closed", "archived"]);
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
// Researcher-issued "test" links bypass the publish gate so the owner can
// self-test a draft survey before opening recruitment. "production" links keep
// the strict published-only gate. See issueLivekitToken handler.
export const LinkKind = z.enum(["production", "test"]);
export const SessionState = z.enum([
  "created",
  "in_progress",
  "completed",
  "abandoned",
  "failed",
]);
export const RecordingFormat = z.enum(["mp3", "opus", "wav", "mp4", "webm"]);
export const ReportScope = z.enum(["session", "survey"]);
export const DashboardScope = z.enum(["study"]);
export const DashboardWidgetType = z.enum([
  "study_progress",
  "recent_sessions",
  "top_themes",
  "top_insights",
  "sentiment_breakdown",
  "bookmarked_quotes",
  "visual_moments",
  "question_stats",
]);

/**
 * @deprecated The researcher identity is owned by Appwrite's built-in Account
 * service, not a business collection. The `users` collection was removed (see
 * docs/design/auth-and-user-research.md §8.3); `ownerUserId` everywhere is the
 * Appwrite Account `$id`. Use `CurrentResearcherSchema` for the read-side view
 * of the logged-in researcher. This schema is kept only for backward type
 * compatibility and must not be reintroduced as a stored collection.
 */
export const UserSchema = z.object({
  $id: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string().datetime(),
});

/**
 * Researcher preferences. Stored inside the Appwrite Account `prefs` JSON, not
 * a collection. This is the contract for `account.updatePrefs` / `getPrefs`.
 */
export const ResearcherPrefsSchema = z.object({
  locale: z.string().default("zh-CN"),
  timeZone: z.string().optional(),
  notifications: z
    .object({
      sessionCompleted: z.boolean().default(true),
      reportReady: z.boolean().default(true),
    })
    .default({ sessionCompleted: true, reportReady: true }),
});

/**
 * Read-only view of the currently authenticated researcher, projected from the
 * Appwrite Account (`account.get()`), not a database row. `id` is the Account
 * `$id` and equals `ownerUserId` on every owner-scoped collection.
 */
export const CurrentResearcherSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  emailVerified: z.boolean(),
  prefs: ResearcherPrefsSchema,
});

export const ProjectSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  name: z.string(),
  description: z.string().default(""),
  createdAt: z.string().datetime(),
});

export const SurveySchema = z.object({
  $id: z.string(),
  projectId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  title: z.string(),
  status: SurveyStatus.default("draft"),
  flowConfig: json.default({}),
  // survey-editor moderator-instruction increment: a dedicated (not flowConfig)
  // field carrying the researcher's directives for the AI voice moderator
  // (tone/pacing-as-behavior/style). Default "" so existing surveys stay valid.
  moderatorInstruction: z.string().default(""),
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
  workspaceId: z.string().optional(),
  token: z.string(),
  mode: LinkMode,
  kind: LinkKind.default("production"),
  maxUses: z.number().int().positive(),
  usedCount: z.number().int().nonnegative().default(0),
  expiresAt: z.string().datetime(),
  isRevoked: z.boolean().default(false),
  label: z.string().optional(),
});

export const TranscriptSegmentSchema = z.object({
  speaker: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});

/**
 * Quality flags derived by `analyzeSession` (rule + LLM mixed). These are
 * *content quality* labels, orthogonal to the system-level `state` enum
 * (created / in_progress / completed / abandoned / failed). A session can be
 * `state=completed` and `qualityFlags=["off-topic", "shallow"]` at the same
 * time — that's the whole point: state describes the flow, qualityFlags
 * describe whether the conversation actually carried research value.
 *
 * See `.kiro/specs/analysis-report-v2/design.md` §4.1 for the derivation
 * strategy and §3 P-ANL-06 for the mutex rules enforced below.
 */
export const SessionQualityFlagSchema = z.enum([
  // mechanical (rule-derived in analyzeSession.qualityFlags.deriveQualityFlagsRule)
  "silent",          // 受访者一句没说 (与 abandoned state 对偶但更细)
  "too-short",       // 总发言文本 < SILENT_RESPONDENT_MIN_CHARS / TOO_SHORT_RESPONDENT_MAX_CHARS 阈值
  "too-long",        // 总通话时长异常超长 (可能闲聊)
  // semantic (LLM-derived in analyzeSession.qualityFlags.deriveQualityFlagsLLM)
  "off-topic",       // 答非所问 / 偏离主题
  "shallow",         // 浮于表面 / 没深度
  "fluent",          // 表达清晰、信息密度高
  "deep-engagement", // 真情流露、给出可操作洞察
  "refused-topic",   // 明确拒绝深入某话题
]);
export type SessionQualityFlag = z.infer<typeof SessionQualityFlagSchema>;

/**
 * Mutex pairs enforced via superRefine (P-ANL-06). The derivation function
 * resolves conflicts by "rule wins over LLM"; this schema-level guard catches
 * any case where the resolution missed.
 */
const SESSION_QUALITY_FLAG_MUTEX_PAIRS: ReadonlyArray<readonly [SessionQualityFlag, SessionQualityFlag]> = [
  ["silent", "fluent"],
  ["silent", "deep-engagement"],
  ["too-short", "deep-engagement"],
  ["fluent", "shallow"],
];

export const InterviewSessionSchema = z
  .object({
    $id: z.string(),
    surveyId: z.string(),
    linkId: z.string(),
    workspaceId: z.string().optional(),
    intervieweeAlias: z.string().optional(),
    state: SessionState.default("created"),
    livekitRoom: z.string(),
    collectedAnswers: json.default({}),
    errorContext: json.optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    qualityFlags: z.array(SessionQualityFlagSchema).default([]),
  })
  .superRefine((session, ctx) => {
    const flagSet = new Set(session.qualityFlags);
    for (const [a, b] of SESSION_QUALITY_FLAG_MUTEX_PAIRS) {
      if (flagSet.has(a) && flagSet.has(b)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["qualityFlags"],
          message: `qualityFlags conflict: "${a}" and "${b}" are mutually exclusive (P-ANL-06)`,
        });
      }
    }
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
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  storageFileId: z.string(),
  durationMs: z.number().int().nonnegative(),
  format: RecordingFormat,
});

export const DashboardSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  surveyId: z.string(),
  scope: DashboardScope.default("study"),
  name: z.string(),
  presetId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DashboardWidgetSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  dashboardId: z.string(),
  surveyId: z.string(),
  widgetType: DashboardWidgetType,
  name: z.string().optional(),
  description: z.string().optional(),
  config: json.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DashboardTileLayoutSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  minW: z.number().int().positive().optional(),
  minH: z.number().int().positive().optional(),
});

export const DashboardTileSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  dashboardId: z.string(),
  surveyId: z.string(),
  widgetId: z.string(),
  layout: DashboardTileLayoutSchema,
  order: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Researcher-saved quote bookmark from an interview transcript turn. */
export const BookmarkSchema = z.object({
  $id: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  surveyId: z.string(),
  sessionId: z.string(),
  quote: z.string(),
  source: z.string(),
  respondent: z.string(),
  segmentIndex: z.number().int().nonnegative().optional(),
  /** Absolute recording offset (ms) this quote anchors to — the seek target for in-app playback. */
  startMs: z.number().int().nonnegative().optional(),
  /** Researcher's own free-text annotation on this saved quote. Empty when unset. */
  note: z.string().default(""),
  /** Researcher-assigned tags for grouping/filtering bookmarks. Deduped, no empties. */
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

/**
 * Persisted report record. The same collection holds both per-session reports
 * (`scope=session`, must carry `sessionId`) and survey-level rollups
 * (`scope=survey`, must carry `surveyId` and must NOT carry `sessionId`).
 *
 * The lifecycle is governed by the `analyzeSession` and `analyzeSurvey`
 * Functions; see `docs/adr/0003-analysis-report-architecture.md` for the
 * trigger model (D1 + D4) and `analysis-report` sub-spec design.md for
 * field semantics.
 */
export const AnalysisReportSchema = z
  .object({
    $id: z.string(),
    sessionId: z.string().optional(),
    surveyId: z.string().optional(),
    scope: ReportScope,
    ownerUserId: z.string(),
    workspaceId: z.string().optional(),
    authorId: z.string().optional(),
    themes: z.array(z.unknown()).default([]),
    insights: z.array(z.unknown()).default([]),
    citations: z.array(z.unknown()).default([]),
    storageFileId: z.string().optional(),
    generatedAt: z.string().datetime(),
  })
  .superRefine((report, ctx) => {
    if (report.scope === "session") {
      if (!report.sessionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sessionId is required when scope=session",
          path: ["sessionId"],
        });
      }
    } else if (report.scope === "survey") {
      if (!report.surveyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "surveyId is required when scope=survey",
          path: ["surveyId"],
        });
      }
      if (report.sessionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sessionId must be absent when scope=survey",
          path: ["sessionId"],
        });
      }
    }
  });

export type SurveyStatus = z.infer<typeof SurveyStatus>;
export type LinkKind = z.infer<typeof LinkKind>;
export type DashboardScope = z.infer<typeof DashboardScope>;
export type DashboardWidgetType = z.infer<typeof DashboardWidgetType>;

/**
 * Allowed survey status transitions. Each key maps to the set of statuses it
 * may move to. Pure data — no I/O. Mirrors the study state graph:
 *   draft → published
 *   published → paused | closed
 *   paused → published | closed
 *   closed → archived
 * `closed` stops new sessions; `archived` is terminal (read-only, hidden from main list).
 */
export const SURVEY_STATUS_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ["published"],
  published: ["paused", "closed"],
  paused: ["published", "closed"],
  closed: ["archived"],
  archived: [],
};

/**
 * Pure guard for survey status transitions. Returns true when moving from
 * `from` to `to` is permitted by SURVEY_STATUS_TRANSITIONS. No side effects.
 */
export function canTransitionSurveyStatus(
  from: SurveyStatus,
  to: SurveyStatus,
): boolean {
  return SURVEY_STATUS_TRANSITIONS[from].includes(to);
}

export type User = z.infer<typeof UserSchema>;
export type ResearcherPrefs = z.infer<typeof ResearcherPrefsSchema>;
export type CurrentResearcher = z.infer<typeof CurrentResearcherSchema>;
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
export type Bookmark = z.infer<typeof BookmarkSchema>;
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;
export type DashboardTileLayout = z.infer<typeof DashboardTileLayoutSchema>;
export type DashboardTile = z.infer<typeof DashboardTileSchema>;

// --- visual analysis jobs (ADR 0005) ---------------------------------------
// Tracks the async post-session Gemini visual-analysis pipeline, one row per
// session. The `$id` is deterministic (`vis_<sessionId>`) so concurrent
// analyzeSessionVisual invocations collide on create (Appwrite 409) and dedup
// per the architecture concurrency contract. The row is also the orphan-file
// record: `geminiFileName` is written BEFORE the ACTIVE-wait so a hard-killed
// run still leaves the file visible to the sweepGeminiFiles Function.
export const VisualAnalysisJobStatus = z.enum([
  "queued",
  "uploading",
  "analyzing",
  "consolidating",
  "succeeded",
  "failed",
]);

/** Statuses past which no further work happens; the sweep may reclaim the file. */
export const VISUAL_ANALYSIS_JOB_TERMINAL_STATUSES = ["succeeded", "failed"] as const;

export const VisualAnalysisJobSchema = z.object({
  $id: z.string(),
  sessionId: z.string(),
  surveyId: z.string(),
  ownerUserId: z.string(),
  workspaceId: z.string().optional(),
  authorId: z.string().optional(),
  status: VisualAnalysisJobStatus.default("queued"),
  // Gemini Files API resource name (e.g. "files/abc123"). Null until the upload
  // returns a name; cleared once the file is deleted. The sweep's delete target.
  geminiFileName: z.string().nullable().default(null),
  // ISO 8601 of upload time; drives the sweep age threshold.
  geminiUploadedAt: z.string().datetime().nullable().default(null),
  attemptCount: z.number().int().nonnegative().default(0),
  errorContext: json.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Deterministic job id — the 409-CAS dedup gate (ADR 0005 D3). */
export function visualAnalysisJobId(sessionId: string): string {
  return `vis_${sessionId}`;
}

export type VisualAnalysisJobStatusValue = z.infer<typeof VisualAnalysisJobStatus>;
export type VisualAnalysisJob = z.infer<typeof VisualAnalysisJobSchema>;

/**
 * Max times analyzeSessionVisual will run for one session before the job is
 * marked permanently failed (ADR 0005 D1 retry cap; Temporal RetryPolicy
 * equivalent). Counts each claim/run attempt, not transport retries.
 */
export const MAX_VISUAL_ANALYSIS_ATTEMPTS = 3;
