"use server";

import { Client, Functions } from "node-appwrite";
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/queries/auth";
import { getStudy } from "@/lib/queries/studies";

const ANALYZE_SURVEY_FN = process.env.ANALYZE_SURVEY_FUNCTION_ID ?? "analyzeSurvey";

/**
 * Trigger `analyzeSurvey` Function for the given surveyId. The Function is
 * idempotent: it always upserts the same `AnalysisReport(scope=survey, surveyId)`
 * row regardless of how often this action runs.
 *
 * Auth: requires a logged-in researcher who owns the survey. We resolve
 * `ownerUserId` from the cookie session (same flow as the read layer) and
 * verify ownership before invoking the Function.
 */
export async function regenerateSurveyReport(
  surveyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!surveyId || typeof surveyId !== "string") {
    return { ok: false, error: "missing_survey_id" };
  }

  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return { ok: false, error: "not_signed_in" };

  const owned = await getStudy(surveyId);
  if (!owned) return { ok: false, error: "not_found_or_forbidden" };

  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    return { ok: false, error: "appwrite_not_configured" };
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  try {
    const execution = await new Functions(client).createExecution(
      ANALYZE_SURVEY_FN,
      JSON.stringify({ surveyId }),
      false,
      undefined,
      "POST" as never,
      { "content-type": "application/json" },
    );
    if (execution.responseStatusCode >= 400) {
      return { ok: false, error: "function_failed" };
    }
    revalidatePath(`/reports/${surveyId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "function_invocation_failed" };
  }
}
