import type { Databases } from "node-appwrite";
import { InterviewSessionSchema } from "@merism/contracts";
import type { InterviewSession } from "@merism/contracts";
import { DATABASE_ID, getServerClient, getSessionDb, Query } from "./client";

const SESSIONS = "interview_sessions";
const SURVEYS = "surveys";

function db(): Databases {
  return getServerClient().databases;
}

/**
 * List sessions for a survey. The survey read goes through the caller's session
 * client — it returns the survey only if the caller may read it (owner or
 * workspace team), which authorizes the request. The sessions themselves are
 * children of that authorized survey and are read by surveyId via the API-key
 * client (the agent writes them and their per-row perms vary).
 */
export async function listSessions(
  surveyId: string,
  databases?: Databases,
): Promise<InterviewSession[]> {
  const dbx = databases ?? (await getSessionDb());
  const surveyCheck = await dbx.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.limit(1),
  ]);
  if (surveyCheck.documents.length === 0) return [];

  const childDb = databases ?? db();
  const result = await childDb.listDocuments(DATABASE_ID, SESSIONS, [
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
  surveyId: string,
  databases?: Databases,
): Promise<number> {
  const sessions = await listSessions(surveyId, databases);
  return sessions.filter((s) => s.state === "completed").length;
}
