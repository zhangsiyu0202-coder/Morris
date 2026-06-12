import type { TranscriptRecord } from "./handler.js";

export interface VideoSegmentSpec {
  id: string;
  startMs: number;
  endMs: number;
  transcriptRefs: Array<{
    transcriptId: string;
    segmentIndex: number;
    speaker: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

export interface SegmentPlanOptions {
  chunkMs?: number;
  minSegmentMs?: number;
  maxSegments?: number;
}

const DEFAULT_CHUNK_MS = 60_000;
const DEFAULT_MIN_SEGMENT_MS = 5_000;
const DEFAULT_MAX_SEGMENTS = 30;

export function calculateVideoSegmentSpecs(
  durationMs: number,
  transcript: TranscriptRecord,
  options: SegmentPlanOptions = {},
): VideoSegmentSpec[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const chunkMs = clampInt(options.chunkMs ?? DEFAULT_CHUNK_MS, 10_000, 180_000);
  const minSegmentMs = clampInt(options.minSegmentMs ?? DEFAULT_MIN_SEGMENT_MS, 1_000, chunkMs);
  const maxSegments = clampInt(options.maxSegments ?? DEFAULT_MAX_SEGMENTS, 1, 120);
  const segments: VideoSegmentSpec[] = [];

  for (let startMs = 0; startMs < durationMs && segments.length < maxSegments; startMs += chunkMs) {
    const endMs = Math.min(durationMs, startMs + chunkMs);
    if (endMs - startMs < minSegmentMs && segments.length > 0) {
      const previous = segments[segments.length - 1];
      previous.endMs = endMs;
      previous.transcriptRefs = refsForWindow(transcript, previous.startMs, previous.endMs);
      break;
    }

    segments.push({
      id: `vseg_${segments.length + 1}`,
      startMs,
      endMs,
      transcriptRefs: refsForWindow(transcript, startMs, endMs),
    });
  }

  return segments;
}

function refsForWindow(transcript: TranscriptRecord, startMs: number, endMs: number): VideoSegmentSpec["transcriptRefs"] {
  return transcript.segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.endMs >= startMs && segment.startMs <= endMs)
    .map(({ segment, index }) => ({
      transcriptId: transcript.$id || transcript.sessionId,
      segmentIndex: index,
      speaker: segment.speaker,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
    }));
}

function clampInt(value: number, min: number, max: number): number {
  const integer = Math.trunc(value);
  if (!Number.isFinite(integer)) return min;
  return Math.min(max, Math.max(min, integer));
}

