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
  type SurveyAnalysisReportOutput,
  type SurveyQuestionStat,
} from "@merism/contracts";

import { aggregateQuestionStats, type AnswerRecord, type SurveyDef } from "./aggregate.js";

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

export interface LlmRollupInput {
  surveyTitle: string;
  totalSessions: number;
  sessionReports: SessionLevelReport[];
}

export interface LlmRollupOutput {
  themes: SurveyAnalysisReportOutput["themes"];
  insights: SurveyAnalysisReportOutput["insights"];
  citations: SurveyAnalysisReportOutput["citations"];
  sentimentBreakdown: SurveyAnalysisReportOutput["sentimentBreakdown"];
  topics?: string[];
  /** Narrative summaries keyed by questionId — merged into questionStats. */
  questionSummaries: Record<string, string>;
}

export interface AnalyzeSurveyDeps {
  findSurveyContext(surveyId: string): Promise<SurveyContextLite | null>;
  findCompletedSessions(surveyId: string): Promise<SessionDigest[]>;
  findSessionReports(sessionIds: string[]): Promise<SessionLevelReport[]>;
  rollupWithLLM(input: LlmRollupInput): Promise<LlmRollupOutput>;
  upsertSurveyReport(args: {
    surveyId: string;
    ownerUserId: string;
    body: SurveyAnalysisReportOutput;
    generatedAt: string;
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

  // 2) LLM rollup (themes / insights / citations / sentimentBreakdown +
  //    narrative summaries).
  let llm: LlmRollupOutput;
  try {
    llm = await deps.rollupWithLLM({
      surveyTitle: survey.title,
      totalSessions: completed.length,
      sessionReports,
    });
  } catch {
    return { status: 500, body: { error: "llm_unavailable" } };
  }

  // Merge narrative summaries into the aggregated questionStats.
  const questionStats: SurveyQuestionStat[] = aggregated.map((stat) => ({
    ...stat,
    summary: llm.questionSummaries[stat.questionId] ?? stat.summary,
  }));

  // P-ANL-04: themes share <= 1.0. Trim or normalize when LLM over-reports.
  const themes = clampThemeShare(llm.themes);

  const body: SurveyAnalysisReportOutput = {
    surveyId,
    surveyTitle: survey.title,
    totalRespondents: completed.length,
    completedRespondents: completed.length,
    avgDurationLabel: "—",
    studyCount: 1,
    lastUpdatedLabel: "just now",
    topics: llm.topics?.length ? llm.topics : survey.topics,
    questionStats,
    sentimentBreakdown: llm.sentimentBreakdown,
    themes,
    insights: llm.insights,
    citations: llm.citations,
    rendered: null,
  };

  let saved: { reportId: string };
  try {
    saved = await deps.upsertSurveyReport({
      surveyId,
      ownerUserId: survey.ownerUserId,
      body,
      generatedAt: new Date(deps.now()).toISOString(),
    });
  } catch {
    return { status: 500, body: { error: "persist_failed" } };
  }

  return { status: 200, body: { reportId: saved.reportId, scope: "survey" } };
}

/**
 * Enforce P-ANL-04: sum of theme.pct/100 must be <= 1.0. When the LLM
 * over-reports, we proportionally scale every share down. This loses
 * absolute calibration but preserves relative ordering between themes.
 */
function clampThemeShare(
  themes: SurveyAnalysisReportOutput["themes"],
): SurveyAnalysisReportOutput["themes"] {
  const sum = themes.reduce((acc, t) => acc + t.pct, 0);
  if (sum <= 100) return themes;
  const scale = 100 / sum;
  return themes.map((t) => ({ ...t, pct: Math.round(t.pct * scale * 10) / 10 }));
}
