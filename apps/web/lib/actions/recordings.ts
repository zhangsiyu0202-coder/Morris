"use server";

import { getRecordingBySession } from "@/lib/queries/recordings";
import { assertSessionOwned } from "@/lib/server/recordings";
import { getOwnerUserIdOrNull } from "@/lib/owner";

export type RecordingDownloadResult =
  | { url: string }
  | { error: "no_recording" | "not_authorized" | "not_authenticated" };

/**
 * Resolve a same-origin download URL for a session recording.
 *
 * The client opens `/api/recordings/[sessionId]/download`, which re-validates
 * ownership and streams from Appwrite Storage. We never return a direct
 * Storage URL: the bucket is `fileSecurity: true` with no public role, and we
 * want the route handler to apply auth + cache-control + filename sanitation
 * uniformly.
 *
 * Pure read action — no side effects, no exceptions across the boundary. A
 * signed-out caller is mapped to `{ error: "not_authenticated" }` rather than
 * throwing so the React `useTransition` caller does not see an unhandled
 * rejection.
 */
export async function getRecordingDownloadUrl(
  sessionId: string,
): Promise<RecordingDownloadResult> {
  const owner = await getOwnerUserIdOrNull();
  if (!owner) return { error: "not_authenticated" };
  if (!(await assertSessionOwned(sessionId, owner))) {
    return { error: "not_authorized" };
  }
  const recording = await getRecordingBySession(sessionId);
  if (!recording) return { error: "no_recording" };
  return { url: `/api/recordings/${sessionId}/download` };
}
