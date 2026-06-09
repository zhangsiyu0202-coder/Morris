import { Storage } from "node-appwrite";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";
import { getRecordingBySession } from "@/lib/queries/recordings";
import { getSessionById } from "@/lib/survey-read";

/**
 * Server-only helpers for the recordings download path. NOT a `"use server"`
 * module: these are called by route handlers (`app/api/recordings/...`) and
 * other server-side helpers, never invoked as RSC server actions, so we keep
 * them out of the action surface to avoid the action-id encoding overhead and
 * to make the trust boundary explicit.
 */

const RECORDING_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  wav: "audio/wav",
};

const RECORDINGS_BUCKET = "recordings";

/**
 * Sanitize a string for safe interpolation into the `Content-Disposition`
 * `filename="…"` parameter. Drops everything outside the conservative
 * RFC-6266 token alphabet (`\w`, `-`, `.`) so a hostile or unusual sessionId
 * cannot break out of the quoted string or inject extra header parameters.
 */
export function safeFilenameToken(raw: string): string {
  const cleaned = raw.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "recording";
}

function recordingFilename(sessionId: string, format: string): string {
  return `interview-${safeFilenameToken(sessionId)}.${format}`;
}

function recordingContentType(format: string): string {
  return RECORDING_MIME[format] ?? "application/octet-stream";
}

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

/** Used by the download route handler after cookie auth is confirmed. */
export async function streamRecordingForOwner(
  sessionId: string,
  ownerUserId: string,
): Promise<{ buffer: ArrayBuffer; filename: string; contentType: string } | null> {
  if (!(await assertSessionOwned(sessionId, ownerUserId))) return null;
  const recording = await getRecordingBySession(sessionId);
  if (!recording) return null;

  // node-appwrite's getFileDownload buffers the whole file into an ArrayBuffer.
  // For interview recordings (capped at 500 MB by the bucket policy) this is
  // acceptable for the MVP but should switch to a true byte-range stream once
  // the SDK exposes one — tracked separately. Until then the route handler
  // sends Content-Length so the client can show progress / abort cleanly.
  const { client } = getServerClient();
  const storage = new Storage(client);
  const buffer = await storage.getFileDownload(RECORDINGS_BUCKET, recording.storageFileId);
  return {
    buffer,
    filename: recordingFilename(sessionId, recording.format),
    contentType: recordingContentType(recording.format),
  };
}

export { assertSessionOwned };
