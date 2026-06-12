// Analyze a single video segment via Gemini Files API + video_metadata offsets.
//
// Mirrors PostHog's a4_analyze_video_segment activity:
//   - Reuses the same uploaded file URI for every segment (no re-upload).
//   - Passes start_offset / end_offset so Gemini only attends to the slice.
//   - Each call is independent — failures stay confined to that segment
//     (the orchestrator collects partial results, see gemini-visual-analyzer.ts).

import type { GeminiClient } from "./client.js";
import type { VideoSegmentSpec } from "../video-segments.js";
import type { SegmentLlmOutput } from "./types.js";

export interface AnalyzeSegmentInputs {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  model: string;
  segment: VideoSegmentSpec;
  prompt: string;
}

interface RawSegmentLlmOutput {
  title?: unknown;
  description?: unknown;
  observations?: unknown;
  issueLevel?: unknown;
  candidateMoments?: unknown;
}

export async function analyzeVideoSegment(inputs: AnalyzeSegmentInputs): Promise<SegmentLlmOutput> {
  const { client, fileUri, mimeType, model, segment, prompt } = inputs;

  const startSec = segment.startMs / 1000;
  const endSec = segment.endMs / 1000;

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri, mimeType },
            videoMetadata: {
              startOffset: `${startSec.toFixed(2)}s`,
              endOffset: `${endSec.toFixed(2)}s`,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });

  const raw = extractText(response);
  const parsed = parseSegmentJson(raw);

  return {
    segmentId: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    title: typeof parsed.title === "string" && parsed.title.trim().length > 0 ? parsed.title.trim() : "(untitled)",
    description:
      typeof parsed.description === "string" && parsed.description.trim().length > 0
        ? parsed.description.trim()
        : "",
    observations: Array.isArray(parsed.observations)
      ? parsed.observations.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [],
    issueLevel: normalizeIssueLevel(parsed.issueLevel),
    candidateMoments: normalizeMoments(parsed.candidateMoments, segment),
  };
}

function extractText(response: { text?: string; candidates?: unknown }): string {
  if (typeof response.text === "string") return response.text;
  // Defensive fallback: pluck text parts from candidates[].content.parts[].text
  const candidates = response.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
  if (text.length === 0) {
    throw new Error("gemini segment analysis returned no text");
  }
  return text;
}

function parseSegmentJson(raw: string): RawSegmentLlmOutput {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawSegmentLlmOutput;
    }
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = JSON.parse(trimmed.slice(start, end + 1));
      if (sliced && typeof sliced === "object" && !Array.isArray(sliced)) {
        return sliced as RawSegmentLlmOutput;
      }
    }
  }
  throw new Error("gemini segment analysis did not return a JSON object");
}

function normalizeIssueLevel(raw: unknown): SegmentLlmOutput["issueLevel"] {
  if (raw === "minor" || raw === "major" || raw === "none") return raw;
  return "none";
}

function normalizeMoments(raw: unknown, segment: VideoSegmentSpec): SegmentLlmOutput["candidateMoments"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m: unknown) => {
      if (!m || typeof m !== "object") return null;
      const obj = m as { timestampMs?: unknown; label?: unknown; description?: unknown };
      const timestampMs = Number(obj.timestampMs);
      if (!Number.isFinite(timestampMs) || timestampMs < 0) return null;
      // Clamp to the segment's window — guards against Gemini hallucinating
      // a timestamp from outside the slice we asked it to look at.
      const clamped = Math.min(Math.max(timestampMs, segment.startMs), segment.endMs);
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      const description = typeof obj.description === "string" ? obj.description.trim() : "";
      if (!label || !description) return null;
      return { timestampMs: clamped, label, description };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}
