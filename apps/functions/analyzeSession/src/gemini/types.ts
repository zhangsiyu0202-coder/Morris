// Shared types for the Gemini visual analysis subsystem.
//
// Mirrors the PostHog session_replay.session_summary.types.video module:
//   - UploadedVideo  (a2 → a4)
//   - VideoSegmentSpec  (already lives in ../video-segments.ts; re-exported here for clarity)
//   - SegmentLlmOutput  (a4 → a6)
//   - SegmentLlmFailure (a4 fail → a6 partial-result handling)
//
// All types are pure data — no SDK or runtime imports.

import type { VideoSegmentSpec } from "../video-segments.js";

export interface UploadedVideo {
  /** Full Gemini Files API URI: https://generativelanguage.googleapis.com/v1beta/files/<id> */
  fileUri: string;
  /** Gemini-side file resource name, e.g. "files/abc123". Used for cleanup. */
  geminiFileName: string;
  /** MIME type, mirrored from the upload request. */
  mimeType: string;
  /** Detected video duration in seconds (from Gemini metadata). 0 if unavailable. */
  durationSec: number;
}

export interface SegmentLlmCandidateMoment {
  /** Absolute (whole-video) ms timestamp where the moment starts. */
  timestampMs: number;
  label: string;
  description: string;
}

export interface SegmentLlmOutput {
  segmentId: string;
  startMs: number;
  endMs: number;
  title: string;
  description: string;
  observations: string[];
  issueLevel: "none" | "minor" | "major";
  candidateMoments: SegmentLlmCandidateMoment[];
}

export interface SegmentLlmFailure {
  segmentId: string;
  startMs: number;
  endMs: number;
  reason: string;
}

export type SegmentLlmResult =
  | { ok: true; output: SegmentLlmOutput }
  | { ok: false; failure: SegmentLlmFailure };

export interface ConsolidatedSummary {
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  tags: string[];
  /** Filtered and ranked from candidate moments emitted by each segment. */
  keyMoments: Array<{
    id: string;
    timestampMs: number;
    label: string;
    description: string;
    segmentId?: string;
  }>;
}

export type { VideoSegmentSpec };
