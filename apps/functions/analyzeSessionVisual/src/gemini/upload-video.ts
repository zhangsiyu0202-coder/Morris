// Upload a video to the Gemini Files API and wait for ACTIVE state.
//
// Mirrors PostHog's a2_upload_video_to_gemini activity:
//   - Upload via Files API (not inline base64)
//   - Poll until state == ACTIVE
//   - Best-effort cleanup if processing times out, so we don't leak files
//
// Returns an UploadedVideo handle to be used by analyze-segment.ts.

import type { GeminiClient } from "./client.js";
import type { UploadedVideo } from "./types.js";

export interface UploadVideoInputs {
  client: GeminiClient;
  videoBytes: Uint8Array;
  mimeType: string;
  /** Display name for traceability; recommended: sessionId or traceId. */
  displayName: string;
  /** Hard cap on processing wait (default 300 s, matches PostHog). */
  maxWaitSeconds?: number;
  /** Polling interval (default 750 ms). */
  pollIntervalMs?: number;
  /** Inject for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called with the Gemini file name the moment the upload returns one, BEFORE
   * the ACTIVE-wait. Lets the caller persist the file reference so a crash
   * during polling still leaves it visible to the sweep (ADR 0005 D2). Awaited.
   */
  onUploadStarted?: (geminiFileName: string) => Promise<void> | void;
}

const DEFAULT_MAX_WAIT_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_MS = 750;

interface GeminiFileResource {
  name?: string;
  uri?: string;
  state?: string | { name?: string };
  videoMetadata?: { videoDuration?: string };
  mimeType?: string;
}

export async function uploadVideoToGemini(inputs: UploadVideoInputs): Promise<UploadedVideo> {
  const {
    client,
    videoBytes,
    mimeType,
    displayName,
    maxWaitSeconds = DEFAULT_MAX_WAIT_SECONDS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    onUploadStarted,
  } = inputs;

  if (videoBytes.byteLength === 0) {
    throw new Error("video bytes are empty");
  }

  const blob = new Blob([videoBytes], { type: mimeType });
  const uploaded = (await client.files.upload({
    file: blob,
    config: { mimeType, displayName },
  })) as GeminiFileResource;

  if (!uploaded.name) {
    throw new Error("gemini upload returned no file name");
  }

  // Track-before-wait (ADR 0005 D2): record the file now so a crash during the
  // ACTIVE-wait still leaves it reclaimable by sweepGeminiFiles. Mirroring
  // PostHog a2: if the tracking write itself fails, delete the just-uploaded
  // file inline (best-effort) so it cannot orphan, then propagate.
  if (onUploadStarted) {
    try {
      await onUploadStarted(uploaded.name);
    } catch (err) {
      await client.files.delete({ name: uploaded.name }).catch(() => undefined);
      throw err;
    }
  }

  let file: GeminiFileResource = uploaded;
  const startedAt = now();

  while (stateName(file) === "PROCESSING") {
    if ((now() - startedAt) / 1000 >= maxWaitSeconds) {
      // Best-effort cleanup so we don't leak orphan files when polling times out.
      await client.files.delete({ name: file.name! }).catch(() => undefined);
      throw new Error("gemini_file_processing_timeout");
    }
    await sleep(pollIntervalMs);
    file = (await client.files.get({ name: file.name! })) as GeminiFileResource;
  }

  if (stateName(file) !== "ACTIVE") {
    await client.files.delete({ name: file.name! }).catch(() => undefined);
    throw new Error(`gemini_file_state_${stateName(file).toLowerCase() || "unknown"}`);
  }
  if (!file.uri) {
    await client.files.delete({ name: file.name! }).catch(() => undefined);
    throw new Error("gemini_file_missing_uri");
  }

  const durationSec = parseDurationSeconds(file.videoMetadata?.videoDuration);

  return {
    fileUri: file.uri,
    geminiFileName: file.name!,
    mimeType: file.mimeType ?? mimeType,
    durationSec,
  };
}

export async function deleteGeminiFile(client: GeminiClient, geminiFileName: string): Promise<void> {
  if (!geminiFileName) return;
  await client.files.delete({ name: geminiFileName }).catch(() => undefined);
}

function stateName(file: GeminiFileResource): string {
  const raw = file.state;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof raw.name === "string") return raw.name;
  return "";
}

/** Parse a duration like "62.5s" → 62.5. Returns 0 on any parse failure. */
function parseDurationSeconds(raw: string | undefined): number {
  if (!raw) return 0;
  const match = /^([\d.]+)s?$/i.exec(raw.trim());
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
