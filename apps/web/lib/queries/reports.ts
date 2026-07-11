import type { Databases } from "node-appwrite";
import {
  AnalysisReportOutputSchema,
  AnalysisReportSchema,
  SurveyAnalysisReportOutputSchema,
} from "@merism/contracts";
import type {
  AnalysisReport,
  AnalysisReportOutput,
  SurveyAnalysisReportOutput,
} from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

const REPORTS = "analysis_reports";

function db(): Databases {
  return getServerClient().databases;
}

interface LatestParams {
  surveyId: string;
  scope: "session" | "survey";
  sessionId?: string;
}

/**
 * Fetch the latest AnalysisReport for a (surveyId, scope) pair, or null when
 * none exists. For `scope=session`, `sessionId` is required and pinpoints the
 * report; for `scope=survey`, `sessionId` must be omitted and the function
 * returns the rolled-up report.
 *
 * Returns the persisted shape (with $id, generatedAt, etc). The body of a
 * survey-level report is stored under the `insights` JSON column shape that
 * matches `SurveyAnalysisReportOutputSchema`; consumers that want the typed
 * body should call `parseSurveyReportBody` below.
 */
export async function getLatestAnalysisReport(
  ownerUserId: string,
  params: LatestParams,
  databases: Databases = db(),
): Promise<AnalysisReport | null> {
  const filters: string[] = [
    Query.equal("scope", params.scope),
    Query.equal("ownerUserId", ownerUserId),
    Query.equal("surveyId", params.surveyId),
    Query.orderDesc("generatedAt"),
    Query.limit(1),
  ];

  if (params.scope === "session") {
    if (!params.sessionId) {
      throw new Error("getLatestAnalysisReport: sessionId is required for scope=session");
    }
    filters.push(Query.equal("sessionId", params.sessionId));
  }

  const result = await databases.listDocuments(DATABASE_ID, REPORTS, filters);
  const raw = result.documents[0];
  if (!raw) return null;

  // Decode JSON-encoded blob columns before validation.
  const decoded = decodeReportColumns(raw);
  const parsed = AnalysisReportSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

/**
 * Parse a survey-level report's body. The persisted `AnalysisReport` keeps
 * the rolled-up structure inside an opaque `insights` JSON column; we
 * validate it against `SurveyAnalysisReportOutputSchema` on read.
 */
export function parseSurveyReportBody(report: AnalysisReport): SurveyAnalysisReportOutput | null {
  if (report.scope !== "survey") return null;
  // The handler stores the body under `insights` for now; revisit when we
  // split into a dedicated body column.
  const candidate = report.insights as unknown;
  const parsed = SurveyAnalysisReportOutputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Parse a session-level report's body. Persisted columns mirror
 * `analyzeSession` upsert: `themes` / `citations` are direct JSON blobs;
 * `insights` holds `{ insights, perQuestionSummary }`.
 */
export function parseSessionReportBody(report: AnalysisReport): AnalysisReportOutput | null {
  if (report.scope !== "session") return null;

  const themes = Array.isArray(report.themes) ? report.themes : [];
  const citations = Array.isArray(report.citations) ? report.citations : [];

  let insights: unknown[] = [];
  let perQuestionSummary: unknown[] = [];
  let visualAnalysis: unknown = null;
  const insightsBlob = report.insights as unknown;
  if (insightsBlob && typeof insightsBlob === "object" && !Array.isArray(insightsBlob)) {
    const blob = insightsBlob as Record<string, unknown>;
    if (Array.isArray(blob.insights)) insights = blob.insights;
    if (Array.isArray(blob.perQuestionSummary)) perQuestionSummary = blob.perQuestionSummary;
    visualAnalysis = blob.visualAnalysis ?? null;
  } else if (Array.isArray(insightsBlob)) {
    insights = insightsBlob;
  }

  const candidate = {
    scope: "session" as const,
    themes,
    insights,
    citations,
    perQuestionSummary,
    rendered: null,
    visualAnalysis,
  };

  const parsed = AnalysisReportOutputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function decodeReportColumns(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  for (const key of ["themes", "insights", "citations"]) {
    const v = r[key];
    if (typeof v === "string") {
      try {
        r[key] = JSON.parse(v);
      } catch {
        r[key] = [];
      }
    }
  }
  return r;
}
