import type { Databases } from "node-appwrite";
import { RecordingSchema } from "@merism/contracts";
import type { Recording } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";

const RECORDINGS = "recordings";

function db(): Databases {
  return getServerClient().databases;
}

function parseRecording(raw: unknown): Recording | null {
  const parsed = RecordingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Fetch the recording document for a session, if one exists. */
export async function getRecordingBySession(
  sessionId: string,
  databases: Databases = db(),
): Promise<Recording | null> {
  const result = await databases.listDocuments(DATABASE_ID, RECORDINGS, [
    Query.equal("sessionId", sessionId),
    Query.limit(1),
  ]);
  const raw = result.documents[0];
  return raw ? parseRecording(raw) : null;
}

/** Batch lookup recordings keyed by sessionId (results table prefetch). */
export async function listRecordingsBySessionIds(
  sessionIds: string[],
  databases: Databases = db(),
): Promise<Map<string, Recording>> {
  const map = new Map<string, Recording>();
  if (sessionIds.length === 0) return map;

  const result = await databases.listDocuments(DATABASE_ID, RECORDINGS, [
    Query.equal("sessionId", sessionIds),
    Query.limit(Math.min(sessionIds.length, 500)),
  ]);

  for (const raw of result.documents) {
    const parsed = parseRecording(raw);
    if (parsed) map.set(parsed.sessionId, parsed);
  }
  return map;
}
