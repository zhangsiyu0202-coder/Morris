import type { Databases } from "node-appwrite";
import { TranscriptSchema, type TranscriptSegment } from "@merism/contracts";
import { DATABASE_ID, getServerClient, Query } from "./client";
import { listSessions } from "./sessions";

const TRANSCRIPTS = "transcripts";

function db(): Databases {
  return getServerClient().databases;
}

export interface TranscriptHit extends TranscriptSegment {
  sessionId: string;
  segmentIndex: number;
  transcriptId: string;
}

interface SearchParams {
  query: string;
  surveyId?: string;
  limit?: number;
}

/**
 * Search transcript segments by keyword.
 *
 * - `query` is a case-insensitive substring match over `segment.text`. Empty
 *   query returns every segment (capped by `limit`).
 * - `surveyId` is required; `listSessions` gates access via the caller's session
 *   client (the survey read returns nothing if the caller may not read it), then
 *   we walk the transcripts of that survey's sessions (read by sessionId via the
 *   API-key client, as children of the authorized survey).
 *
 * Implementation note: Appwrite full-text search would be a better fit for v2;
 * for now we paginate transcripts and filter in-process so we never miss matches
 * across segments. The agent writes transcript segments as a JSON array on the
 * Transcript document, not separate rows.
 */
export async function searchTranscriptSegments(
  params: SearchParams,
  databases?: Databases,
): Promise<TranscriptHit[]> {
  const limit = params.limit ?? 30;
  const needle = params.query.trim().toLowerCase();

  if (!params.surveyId) {
    // Without a surveyId we'd need to enumerate every survey; this path is rare
    // (the assistant always passes a study id) so we keep it short-circuited.
    return [];
  }

  const sessions = await listSessions(params.surveyId, databases);
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.$id);
  const childDb = databases ?? db();
  const transcriptResult = await childDb.listDocuments(DATABASE_ID, TRANSCRIPTS, [
    Query.equal("sessionId", sessionIds),
    Query.limit(500),
  ]);

  const hits: TranscriptHit[] = [];
  for (const raw of transcriptResult.documents) {
    // The persisted shape stores `segments` as a JSON-encoded string; decode
    // before validating against the contract.
    const decoded = decodeTranscript(raw);
    const parsed = TranscriptSchema.safeParse(decoded);
    if (!parsed.success) continue;
    const t = parsed.data;
    t.segments.forEach((segment, index) => {
      if (needle && !segment.text.toLowerCase().includes(needle)) return;
      hits.push({
        ...segment,
        sessionId: t.sessionId,
        transcriptId: t.$id,
        segmentIndex: index,
      });
      if (hits.length >= limit) return;
    });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

function decodeTranscript(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  if (typeof r.segments === "string") {
    try {
      return { ...r, segments: JSON.parse(r.segments) };
    } catch {
      return { ...r, segments: [] };
    }
  }
  return raw;
}
