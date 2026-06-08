"use server";

import { Storage } from "node-appwrite";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";
import { getRecordingBySession } from "@/lib/queries/recordings";
import { getSessionById } from "@/lib/survey-read";
import { requireOwnerUserId } from "@/lib/owner";

const RECORDING_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  wav: "audio/wav",
};

function recordingFilename(sessionId: string, format: string): string {
  return `interview-${sessionId}.${format}`;
}

function recordingContentType(format: string): string {
  return RECORDING_MIME[format] ?? "application/octet-stream";
}

const RECORDINGS_BUCKET = "recordings";

async function assertSessionOwned(sessionId: string, ownerUserId: string): Promise<boolean> {
  const session = await getSessionById(sessionId);
  if (!session) return false;
  try {
    const doc = await getServerClient().databases.getDocument(
      DATABASE_ID,
      "surveys",
      session.surveyId,
    );
    return (doc as { ownerUserId?: string }).ownerUserId === ownerUserId;
  } catch {
    return false;
  }
}

export type RecordingDownloadResult =
  | { url: string }
  | { error: "no_recording" | "not_authorized" };

/**
 * Resolve a same-origin download URL for a session recording.
 * The client opens `/api/recordings/[sessionId]/download`, which re-validates
 * ownership and streams from Appwrite Storage.
 */
export async function getRecordingDownloadUrl(
  sessionId: string,
): Promise<RecordingDownloadResult> {
  const owner = await requireOwnerUserId();
  if (!(await assertSessionOwned(sessionId, owner))) {
    return { error: "not_authorized" };
  }
  const recording = await getRecordingBySession(sessionId);
  if (!recording) return { error: "no_recording" };
  return { url: `/api/recordings/${sessionId}/download` };
}

/** Used by the download route handler after cookie auth is confirmed. */
export async function streamRecordingForOwner(
  sessionId: string,
  ownerUserId: string,
): Promise<{ buffer: ArrayBuffer; filename: string; contentType: string } | null> {
  if (!(await assertSessionOwned(sessionId, ownerUserId))) return null;
  const recording = await getRecordingBySession(sessionId);
  if (!recording) return null;

  const { client } = getServerClient();
  const storage = new Storage(client);
  const buffer = await storage.getFileDownload(RECORDINGS_BUCKET, recording.storageFileId);
  return {
    buffer,
    filename: recordingFilename(sessionId, recording.format),
    contentType: recordingContentType(recording.format),
  };
}
