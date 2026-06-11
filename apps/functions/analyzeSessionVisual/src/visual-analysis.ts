import type { VisualAnalysisOutput } from "@merism/contracts";
import type { TranscriptRecord } from "./handler.js";
import type { VideoSegmentSpec } from "./video-segments.js";

export interface RecordingRecord {
  $id: string;
  sessionId: string;
  ownerUserId: string;
  storageFileId: string;
  durationMs: number;
  format: "mp3" | "opus" | "wav" | "mp4" | "webm";
}

export interface RecordingBytes {
  bytes: Uint8Array;
  mimeType: string;
}

export interface VisualAnalysisInput {
  sessionId: string;
  recording: RecordingRecord;
  transcript: TranscriptRecord;
  media: RecordingBytes;
  segmentSpecs: VideoSegmentSpec[];
}

export type VisualAnalyzer = (input: VisualAnalysisInput) => Promise<VisualAnalysisOutput>;

export function recordingMimeType(format: RecordingRecord["format"]): string {
  const byFormat: Record<RecordingRecord["format"], string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    opus: "audio/ogg",
    wav: "audio/wav",
  };
  return byFormat[format];
}

export function isVisualRecording(recording: RecordingRecord): boolean {
  return recording.format === "mp4" || recording.format === "webm";
}
