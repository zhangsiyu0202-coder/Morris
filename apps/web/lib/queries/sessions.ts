import type { Databases } from "node-appwrite";
import { InterviewSessionSchema } from "@merism/contracts";
import type { InterviewSession } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

const SESSIONS = "interview_sessions";
const SURVEYS = "surveys";

function db(): Databases {
  return getServerClient().databases;
}

/**
 * List sessions for a given survey, scoped to the owner. We pre-check survey
 * ownership rather than relying on Appwrite filters alone — the agent worker
 * may write sessions with a different document-permission shape, so the
 * survey check is the canonical authorization gate.
 */
export async function listSessions(
  ownerUserId: string,
  surveyId: string,
  databases: Databases = db(),
): Promise<InterviewSession[]> {
  // Verify the survey is owned by this user. Skipping ownerUserId check on
  // sessions themselves is intentional: sessions are written by the agent
  // worker (server key) and may not carry a researcher-pinned permission.
  const surveyCheck = await databases.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.equal("ownerUserId", ownerUserId),
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
  ownerUserId: string,
  surveyId: string,
  databases: Databases = db(),
): Promise<number> {
  const sessions = await listSessions(ownerUserId, surveyId, databases);
  return sessions.filter((s) => s.state === "completed").length;
}
