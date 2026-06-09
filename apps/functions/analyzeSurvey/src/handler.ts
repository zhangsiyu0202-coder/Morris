// Pure analyzeSurvey core. No SDK imports.
//
// Flow:
//   1. validate input (400 invalid_input)
//   2. find survey context (404 survey_not_found)
//   3. find all completed sessions; if 0 -> 409 no_completed_sessions
//   4. find all session-level reports for those sessions
//   5. compute pure data reduction (questionStats, completedRespondents)
//   6. call LLM rollup (themes / insights / citations / sentimentBreakdown / topics
//      + narrative summaries to merge into questionStats)
//   7. upsert AnalysisReport(scope=survey) keyed by surveyId (idempotent)
//   8. return 200 { reportId, scope: "survey" }

import {
  AnalyzeSurveyRequestSchema,
  type AnalyzeSurveyResponse,
  type GenerationMeta,
  type SurveyAnalysisReportOutput,
  type SurveyQuestionStat,
} from "@merism/contracts";

import { aggregateQuestionStats, type AnswerRecord, type SurveyDef } from "./aggregate.js";
import {
  applyThemeSentiments,
  buildGenerationMeta,
  chunkSessionReports,
  enrichSurveyThemes,
  mergeThemeAssignments,
  type ComposeInsightsOutput,
  type ExtractedThemes,
  type ThemeAssignments,
  type ThemeContext,
  type SurveyThemePreSentiment,
} from "./rollup.js";
import {
  buildValidRefsFromSessionReports,
  checkHallucinationRatio,
} from "./hallucination.js";
import {
  ASSIGNMENT_CHUNK_SIZE,
  EXTRACTION_CHUNK_SIZE,
  EXTRACTION_CHUNK_THRESHOLD,
  HALLUCINATION_RATIO_THRESHOLD,
} from "./constants.js";
import { PROMPT_VERSION } from "./prompts/version.js";

export interface SessionDigest {
  sessionId: string;
  transcriptId: string;
  state: "created" | "in_progress" | "completed" | "abandoned" | "failed";
  /** Already extracted from collectedAnswers; the deps layer normalizes this. */
  answers: AnswerRecord[];
}

export interface SessionLevelReport {
  reportId: string;
  sessionId: string;
  themes: unknown[];
  insights: unknown[];
  citations: unknown[];
  perQuestionSummary: unknown[];
}

export interface SurveyContextLite {
  surveyId: string;
  ownerUserId: string;
  title: string;
  questionBlocks: SurveyDef["questionBlocks"];
  topics: string[];
}

/** Stage 1: extract themes (no session attribution). */
export interface ExtractThemesInput {
  surveyTitle: string;
  totalSessions: number;
  sessionReports: SessionLevelReport[];
}

/** Stage 1.5 (Wave F / D15): combine multiple chunked extraction outputs into one. */
export interface CombineThemesInput {
  surveyTitle: string;
  totalSessions: number;
  rawThemesList: ExtractedThemes[];
}

/** Stage 2: assign themes to sessions. */
export interface AssignThemesInput {
  surveyTitle: string;
  themes: Array<{ id: string; label: string; description: string }>;
  sessionReports: SessionLevelReport[];
}

/** Stage 3: compose insights/citations/topics/sentimentBreakdown + themeSentiments + questionSummaries. */
export interface ComposeInsightsInput {
  surveyTitle: string;
  totalSessions: number;
  themes: SurveyThemePreSentiment[];
  themeContexts: ThemeContext[];
  questionStats: Array<{ questionId: string; kind: string }>;
  sessionReports: SessionLevelReport[];
  /** R3 retry: when present, prepend a hallucination hint to user prompt. */
  hallucinationHint?: { badRefs: Array<{ transcriptId: string; segmentIndex: number }> };
}

export interface AnalyzeSurveyDeps {
  findSurveyContext(surveyId: string): Promise<SurveyContextLite | null>;
  findCompletedSessions(surveyId: string): Promise<SessionDigest[]>;
  findSessionReports(sessionIds: string[]): Promise<SessionLevelReport[]>;
  // analysis-report-v2 R4 三阶段 LLM (替代原单段 rollupWithLLM):
  extractThemesWithLLM(input: ExtractThemesInput): Promise<ExtractedThemes>;
  assignThemesWithLLM(input: AssignThemesInput): Promise<ThemeAssignments>;
  /** Wave F (D15): chunked extract 后合并多份 themes 为统一一份。 */
  combineThemesWithLLM(input: CombineThemesInput): Promise<ExtractedThemes>;
  composeInsightsWithLLM(input: ComposeInsightsInput): Promise<ComposeInsightsOutput>;
  upsertSurveyReport(args: {
    surveyId: string;
    ownerUserId: string;
    body: SurveyAnalysisReportOutput;
    generatedAt: string;
    /** Optional v2 generation metadata (R2). */
    generationMeta?: GenerationMeta;
  }): Promise<{ reportId: string }>;
  now(): number;
}

export type AnalyzeSurveyResult =
  | { status: 200; body: AnalyzeSurveyResponse }
  | { status: 400 | 404 | 409 | 500; body: { error: string; traceId?: string } };

export async function analyzeSurvey(
  rawInput: unknown,
  deps: AnalyzeSurveyDeps,
): Promise<AnalyzeSurveyResult> {
  const parsed = AnalyzeSurveyRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { surveyId } = parsed.data;

  const survey = await deps.findSurveyContext(surveyId);
  if (!survey) return { status: 404, body: { error: "survey_not_found" } };

  const sessions = await deps.findCompletedSessions(surveyId);
  const completed = sessions.filter((s) => s.state === "completed");
  if (completed.length === 0) {
    return { status: 409, body: { error: "no_completed_sessions" } };
  }

  const sessionReports = await deps.findSessionReports(completed.map((s) => s.sessionId));

  // 1) Pure data reduction.
  const allAnswers = completed.flatMap((s) => s.answers);
  const aggregated = aggregateQuestionStats(
    { surveyId, title: survey.title, questionBlocks: survey.questionBlocks },
    allAnswers,
  );

  // analysis-report-v2 R4 + R6: 三阶段 rollup, 大样本走 chunk + combination (D15)。
  // 任一阶段 LLM 调用失败 → 整次 reject (不写部分数据), R3 hallucination 校验
  // 只在 compose 阶段输出后做 (因为只有 citations 是新生成的 segmentRef 引用)。

  let extracted: ExtractedThemes;
  let extractChunkCount = 1;
  try {
    if (sessionReports.length > EXTRACTION_CHUNK_THRESHOLD) {
      // Chunked 路径 (Wave F / D15): N > 10 时切块并行抽取后 combine。
      const chunks = chunkSessionReports(sessionReports, EXTRACTION_CHUNK_SIZE);
      extractChunkCount = chunks.length;
      const rawThemesList = await Promise.all(
        chunks.map((chunk) =>
          deps.extractThemesWithLLM({
            surveyTitle: survey.title,
            totalSessions: completed.length,
            sessionReports: chunk,
          }),
        ),
      );
      extracted = await deps.combineThemesWithLLM({
        surveyTitle: survey.title,
        totalSessions: completed.length,
        rawThemesList,
      });
    } else {
      // 单 chunk 路径 (Wave D): N ≤ 10 直接单次抽取, 不调 combine 省 token。
      extracted = await deps.extractThemesWithLLM({
        surveyTitle: survey.title,
        totalSessions: completed.length,
        sessionReports,
      });
    }
  } catch {
    return { status: 500, body: { error: "llm_unavailable" } };
  }

  // Assignment 阶段一律走 chunk + 代码 merge (P-ANL-08 锁定: 与单次 assign 在
  // (themeId → sessionIds) 字段集层面等价)。
  let assignments: ThemeAssignments;
  let assignChunkCount = 1;
  try {
    const assignChunks = chunkSessionReports(sessionReports, ASSIGNMENT_CHUNK_SIZE);
    assignChunkCount = assignChunks.length;
    const rawAssignments = await Promise.all(
      assignChunks.map((chunk) =>
        deps.assignThemesWithLLM({
          surveyTitle: survey.title,
          themes: extracted.themes.map((t) => ({
            id: t.id,
            label: t.label,
            description: t.description,
          })),
          sessionReports: chunk,
        }),
      ),
    );
    assignments = mergeThemeAssignments(rawAssignments);
  } catch {
    return { status: 500, body: { error: "llm_unavailable" } };
  }

  // Pure: P-ANL-07 在这层锁死 (mentions/pct 由代码算; share normalize 守 P-ANL-04)。
  const enriched = enrichSurveyThemes(extracted.themes, assignments.assignments, completed.length);

  // R3 hallucination 校验: validRefs 是 sessionReports 已有 segmentRef 集合 (design §6.4)。
  const validRefs = buildValidRefsFromSessionReports(sessionReports);

  let compose: ComposeInsightsOutput;
  let attemptCount = 0;
  let hallucinationCheck:
    | { ratio: number; ok: boolean; totalRefs: number; badRefs: { transcriptId: string; segmentIndex: number }[] }
    | undefined;
  let lastBadRefs: { transcriptId: string; segmentIndex: number }[] = [];

  for (attemptCount = 1; attemptCount <= 2; attemptCount++) {
    try {
      compose = await deps.composeInsightsWithLLM({
        surveyTitle: survey.title,
        totalSessions: completed.length,
        themes: enriched.themes,
        themeContexts: enriched.themeContexts,
        questionStats: aggregated.map((s) => ({ questionId: s.questionId, kind: s.kind })),
        sessionReports,
        ...(attemptCount === 2 ? { hallucinationHint: { badRefs: lastBadRefs } } : {}),
      });
    } catch {
      return { status: 500, body: { error: "llm_unavailable" } };
    }
    hallucinationCheck = checkHallucinationRatio({
      themes: [], // survey-level themes 没有 evidence 字段(SurveyThemeSchema 不含),只校 citations
      citations: compose.citations,
      validRefs,
      threshold: HALLUCINATION_RATIO_THRESHOLD,
    });
    if (hallucinationCheck.ok) break;
    lastBadRefs = hallucinationCheck.badRefs;
  }

  compose = compose!;
  if (!hallucinationCheck!.ok) {
    return {
      status: 409,
      body: { error: "analysis_rejected" },
    };
  }

  // sentiment 回填 (C1/I3 修订: themes 落库形态 = preSentiment + themeSentiments)
  const themesFinal = applyThemeSentiments(enriched.themes, compose.themeSentiments);

  // Merge narrative summaries into the aggregated questionStats.
  const questionStats: SurveyQuestionStat[] = aggregated.map((stat) => ({
    ...stat,
    summary: compose.questionSummaries[stat.questionId] ?? stat.summary,
  }));

  const generationMeta = buildGenerationMeta({
    promptVersion: PROMPT_VERSION,
    attemptCount,
    hallucinationRatio: hallucinationCheck!.ratio,
    models: {
      extract: "deepseek-chat",
      assign: "deepseek-chat",
      compose: "deepseek-chat",
      combine: "deepseek-chat",
    },
    extractChunkCount,
    assignChunkCount,
  });

  const body: SurveyAnalysisReportOutput = {
    surveyId,
    surveyTitle: survey.title,
    totalRespondents: completed.length,
    completedRespondents: completed.length,
    avgDurationLabel: "—",
    studyCount: 1,
    lastUpdatedLabel: "just now",
    topics: compose.topics?.length ? compose.topics : survey.topics,
    questionStats,
    sentimentBreakdown: compose.sentimentBreakdown,
    themes: themesFinal,
    insights: compose.insights,
    citations: compose.citations,
    rendered: null,
  };

  let saved: { reportId: string };
  try {
    saved = await deps.upsertSurveyReport({
      surveyId,
      ownerUserId: survey.ownerUserId,
      body,
      generatedAt: new Date(deps.now()).toISOString(),
      generationMeta,
    });
  } catch {
    return { status: 500, body: { error: "persist_failed" } };
  }

  return { status: 200, body: { reportId: saved.reportId, scope: "survey" } };
}

