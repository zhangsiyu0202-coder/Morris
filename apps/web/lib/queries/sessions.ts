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
 *
 * Reads the count via Appwrite's `total` field (returned regardless of limit),
 * with the state filter pushed down to the DB so we do not fetch + zod-parse
 * every session doc just to filter `state` in JS. The survey-existence read
 * via the session client still gates access (caller may not read the survey →
 * count is 0).
 */
export async function countCompletedSessions(
  surveyId: string,
  databases?: Databases,
): Promise<number> {
  const dbx = databases ?? (await getSessionDb());
  const surveyCheck = await dbx.listDocuments(DATABASE_ID, SURVEYS, [
    Query.equal("$id", surveyId),
    Query.limit(1),
  ]);
  if (surveyCheck.documents.length === 0) return 0;

  // Sessions have no per-row read perms (the agent writes them with the API
  // key), so the count read uses the API-key client. limit(1) means we
  // transfer at most one doc body; the `total` field is the real payload.
  const childDb = databases ?? db();
  const result = await childDb.listDocuments(DATABASE_ID, SESSIONS, [
    Query.equal("surveyId", surveyId),
    Query.equal("state", "completed"),
    Query.limit(1),
  ]);
  return result.total;
}
