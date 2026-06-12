import type { Databases } from "node-appwrite";
import { InterviewSessionSchema } from "@merism/contracts";
import type { InterviewSession } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query, tenantFilter, type TenantScope } from "./client";

const SESSIONS = "interview_sessions";
const SURVEYS = "surveys";

function db(): Databases {
  return getServerClient().databases;
}

/**
 * List sessions for a given survey, scoped to the caller's tenant. We pre-check
 * that the survey is readable by the caller (workspace, else solo owner) rather
 * than relying on Appwrite filters on the sessions alone — the agent worker may
 * write sessions with a different document-permission shape, so the survey
 * check is the canonical authorization gate.
 */
export async function listSessions(
  scope: TenantScope,
  surveyId: string,
  databases: Databases = db(),
): Promise<InterviewSession[]> {
  // Verify the survey belongs to the caller's tenant. Skipping a scope check on
  // sessions themselves is intentional: sessions are written by the agent
  // worker (server key) and may not carry a researcher-pinned permission.
  const surveyCheck = await databases.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    tenantFilter(scope),
    Query.limit(1),
  ]);
  if (surveyCheck.documents.length === 0) return [];

  const result = await databases.listDocuments(DATABASE_ID, SESSIONS, [
    Query.equal("surveyId", surveyId),
    Query.orderDesc("startedAt"),
    Query.limit(500),
  ]);

  const out: InterviewSession[] = [];
  for (const raw of result.documents) {
    const parsed = InterviewSessionSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Count completed sessions for a survey. Used by the report viewer's empty /
 * loading / rendered triptych (D5) and by the survey-level rollup invariant
 * P-ANL-03 (completedRespondents == count of completed sessions).
 */
export async function countCompletedSessions(
  scope: TenantScope,
  surveyId: string,
  databases: Databases = db(),
): Promise<number> {
  const sessions = await listSessions(scope, surveyId, databases);
  return sessions.filter((s) => s.state === "completed").length;
}
