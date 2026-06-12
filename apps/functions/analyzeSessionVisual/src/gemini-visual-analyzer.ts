// Gemini-based visual analysis pipeline (PostHog-style).
//
// PostHog's session_summary.workflow.py orchestrates four activities:
//   a2 prep_session_video_asset  →  upload-video.ts
//   a3 slice_session_data        →  ../video-segments.ts (already exists)
//   a4 analyze_video_segment     →  analyze-segment.ts (one Gemini call per segment)
//   a6 consolidate_video_segments →  consolidate.ts + ../prompts/visual-consolidation.ts
//                                    + cleanup the uploaded file
//
// This module is the orchestrator. Plus the partial-result handling
// PostHog doesn't have but Merism wants (failed-segment metadata).

import {
  VisualAnalysisOutputSchema,
  type VisualAnalysisOutput,
} from "@merism/contracts";
import type { GeminiClient } from "./gemini/client.js";
import { createGeminiClient } from "./gemini/client.js";
import { uploadVideoToGemini, deleteGeminiFile } from "./gemini/upload-video.js";
import { analyzeVideoSegment } from "./gemini/analyze-segment.js";
import { buildFallbackSummary, validateAndClampConsolidatedSummary, type Consolidator } from "./gemini/consolidate.js";
import type {
  SegmentLlmFailure,
  SegmentLlmOutput,
  SegmentLlmResult,
} from "./gemini/types.js";
import { buildSegmentPrompt, VISUAL_SEGMENT_ANALYSIS_SYSTEM } from "./prompts/visual-segment-analysis.js";
import type { VideoSegmentSpec } from "./video-segments.js";
import type { VisualAnalyzer, VisualAnalysisInput } from "./visual-analysis.js";

export interface GeminiVisualConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxBytes: number;
  uploadMaxWaitSec: number;
  segmentParallelism: number;
  /** Minimum fraction of segments that must succeed; below this the run is failed. */
  minSuccessRatio: number;
}

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (Gemini Files API limit)
const DEFAULT_UPLOAD_MAX_WAIT_SEC = 300;
const DEFAULT_SEGMENT_PARALLELISM = 4;
const DEFAULT_MIN_SUCCESS_RATIO = 0.5;

export interface GeminiVisualAnalyzerDeps {
  consolidator: Consolidator;
  /** Optional: inject a prebuilt client for tests. */
  client?: GeminiClient;
  /** Optional: inject a factory for tests. */
  buildClient?: (config: GeminiVisualConfig) => Promise<GeminiClient>;
  config: GeminiVisualConfig;
  /**
   * Lifecycle hooks. `onFileUploaded` fires with the Gemini file name before
   * the ACTIVE-wait so the caller (analyzeSessionVisual) can persist it to the
   * job row for the sweep (ADR 0005 D2).
   */
  hooks?: {
    onFileUploaded?: (geminiFileName: string) => Promise<void> | void;
  };
}

/**
 * Build a VisualAnalyzer that runs Gemini's per-segment analysis pipeline.
 * The returned function matches the existing VisualAnalyzer signature, so
 * the analyzeSession handler does not need any changes.
 */
export function createGeminiVisualAnalyzer(deps: GeminiVisualAnalyzerDeps): VisualAnalyzer {
  const { config } = deps;

  return async (input: VisualAnalysisInput): Promise<VisualAnalysisOutput> => {
    if (input.media.bytes.byteLength === 0) {
      throw new Error("recording is empty");
    }
    if (input.media.bytes.byteLength > config.maxBytes) {
      throw new Error(`recording exceeds GEMINI_VIDEO_MAX_BYTES (${config.maxBytes})`);
    }
    if (input.segmentSpecs.length === 0) {
      return emptyVisualAnalysis(input, config.model);
    }

    const factory = deps.buildClient ?? createGeminiClient;
    const client = deps.client ?? (await factory(config));

    const uploaded = await uploadVideoToGemini({
      client,
      videoBytes: input.media.bytes,
      mimeType: input.media.mimeType,
      displayName: input.sessionId,
      maxWaitSeconds: config.uploadMaxWaitSec,
      onUploadStarted: deps.hooks?.onFileUploaded,
    });

    try {
      const totalDurationMs = input.recording.durationMs;
      const segmentResults = await mapWithConcurrency(
        input.segmentSpecs,
        config.segmentParallelism,
        async (segment): Promise<SegmentLlmResult> => {
          try {
            const output = await analyzeVideoSegment({
              client,
              fileUri: uploaded.fileUri,
              mimeType: uploaded.mimeType,
              model: config.model,
              segment,
              prompt: composeSegmentPrompt(segment, totalDurationMs),
            });
            return { ok: true, output };
          } catch (err) {
            return {
              ok: false,
              failure: {
                segmentId: segment.id,
                startMs: segment.startMs,
                endMs: segment.endMs,
                reason: err instanceof Error ? err.message : String(err),
              },
            };
          }
        },
      );

      const succeeded: SegmentLlmOutput[] = [];
      const failed: SegmentLlmFailure[] = [];
      for (const r of segmentResults) {
        if (r.ok) succeeded.push(r.output);
        else failed.push(r.failure);
      }

      const ratio = succeeded.length / segmentResults.length;
      if (ratio < config.minSuccessRatio) {
        const sample = failed.slice(0, 3).map((f) => `${f.segmentId}:${f.reason}`).join("; ");
        throw new Error(
          `gemini_visual_too_many_segment_failures: ${failed.length}/${segmentResults.length} failed (${sample})`,
        );
      }

      const transcriptText = stitchTranscript(input.transcript);
      let consolidated;
      try {
        consolidated = await deps.consolidator({
          segments: succeeded,
          expectedSegmentCount: segmentResults.length,
          transcriptText,
        });
      } catch (err) {
        // PostHog defaults to bubbling up; we soften: fall back to deterministic
        // summary so the researcher still gets the per-segment view + a
        // best-effort summary, with `provenance` recording the failure.
        consolidated = buildFallbackSummary({
          segments: succeeded,
          expectedSegmentCount: segmentResults.length,
          transcriptText,
        });
        consolidated.tags = uniq([
          ...consolidated.tags,
          "consolidation_fallback",
          err instanceof Error ? `consolidator_error:${truncate(err.message, 40)}` : "consolidator_error",
        ]);
      }

      // Validate/clamp once, centrally — guards both the DeepSeek and fallback
      // paths so LLM output can't contradict the deterministic segment evidence.
      consolidated = validateAndClampConsolidatedSummary(consolidated, succeeded);

      const candidate = assembleVisualAnalysis({
        input,
        config,
        succeeded,
        failed,
        consolidated,
      });
      return VisualAnalysisOutputSchema.parse(candidate);
    } finally {
      // Best-effort cleanup. Don't fail the analysis if delete fails — Google
      // auto-purges Files after 48 hours anyway.
      await deleteGeminiFile(client, uploaded.geminiFileName);
    }
  };
}

function composeSegmentPrompt(segment: VideoSegmentSpec, totalDurationMs: number): string {
  return [
    VISUAL_SEGMENT_ANALYSIS_SYSTEM,
    "",
    buildSegmentPrompt({ segment, totalDurationMs }),
  ].join("\n");
}

function assembleVisualAnalysis(args: {
  input: VisualAnalysisInput;
  config: GeminiVisualConfig;
  succeeded: SegmentLlmOutput[];
  failed: SegmentLlmFailure[];
  consolidated: Awaited<ReturnType<Consolidator>>;
}): unknown {
  const { input, config, succeeded, failed, consolidated } = args;

  // Map back to VisualAnalysisOutputSchema's segment shape: keep evidence
  // anchored to the original transcriptRefs (deterministic) rather than
  // letting the model invent transcript IDs.
  const specsById = new Map(input.segmentSpecs.map((s) => [s.id, s]));
  const segments = succeeded.map((seg) => {
    const spec = specsById.get(seg.segmentId);
    return {
      id: seg.segmentId,
      startMs: seg.startMs,
      endMs: seg.endMs,
      title: seg.title,
      description: seg.description,
      observations: seg.observations,
      issueLevel: seg.issueLevel,
      evidence: (spec?.transcriptRefs ?? []).map((ref) => ({
        transcriptId: ref.transcriptId,
        segmentIndex: ref.segmentIndex,
      })),
    };
  });

  const baseTags = consolidated.tags;
  const provenanceTags = failed.length > 0 ? [`failed_segments:${failed.length}`] : [];

  return {
    source: "recording" as const,
    recordingFileId: input.recording.storageFileId,
    durationMs: input.recording.durationMs,
    visualConfirmation: succeeded.length > 0,
    summary: consolidated.summary,
    sentiment: consolidated.sentiment,
    frustrationScore: consolidated.frustrationScore ?? 0,
    outcome: consolidated.outcome ?? "successful",
    sentimentSignals: consolidated.sentimentSignals ?? [],
    tags: uniq([...baseTags, ...provenanceTags]),
    tagsFixed: consolidated.tagsFixed ?? [],
    tagsFreeform: consolidated.tagsFreeform ?? [],
    highlighted: consolidated.highlighted ?? false,
    segments,
    keyMoments: consolidated.keyMoments,
    modelId: config.model,
    generatedAt: new Date().toISOString(),
  };
}

function emptyVisualAnalysis(input: VisualAnalysisInput, modelId: string): VisualAnalysisOutput {
  return VisualAnalysisOutputSchema.parse({
    source: "recording",
    recordingFileId: input.recording.storageFileId,
    durationMs: input.recording.durationMs,
    visualConfirmation: false,
    summary: "本次访谈录像没有足够的可分析时段。",
    sentiment: "neutral",
    tags: [],
    segments: [],
    keyMoments: [],
    modelId,
    generatedAt: new Date().toISOString(),
  });
}

function stitchTranscript(transcript: VisualAnalysisInput["transcript"]): string {
  return transcript.segments.map((s) => `[${s.speaker}] ${s.text}`).join("\n");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// --- env-driven factory ---------------------------------------------------

export interface CreateGeminiVisualAnalyzerFromEnvInputs {
  consolidator: Consolidator;
  env?: NodeJS.ProcessEnv;
}

export function geminiVisualConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GeminiVisualConfig | undefined {
  if (env.GEMINI_VISUAL_ANALYSIS_ENABLED !== "true") return undefined;

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "changeme") {
    throw new Error("GEMINI_API_KEY is required when GEMINI_VISUAL_ANALYSIS_ENABLED=true");
  }
  const baseUrl = env.GEMINI_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("GEMINI_API_BASE_URL is required when GEMINI_VISUAL_ANALYSIS_ENABLED=true");
  }

  return {
    baseUrl,
    apiKey,
    model: env.GEMINI_VISUAL_MODEL || DEFAULT_MODEL,
    maxBytes: parseInteger(env.GEMINI_VIDEO_MAX_BYTES, DEFAULT_MAX_BYTES),
    uploadMaxWaitSec: parseInteger(env.GEMINI_UPLOAD_MAX_WAIT_SEC, DEFAULT_UPLOAD_MAX_WAIT_SEC),
    segmentParallelism: parseInteger(env.GEMINI_SEGMENT_PARALLELISM, DEFAULT_SEGMENT_PARALLELISM),
    minSuccessRatio: parseRatio(env.GEMINI_MIN_SUCCESS_RATIO, DEFAULT_MIN_SUCCESS_RATIO),
  };
}

export function createGeminiVisualAnalyzerFromEnv(
  inputs: CreateGeminiVisualAnalyzerFromEnvInputs,
): VisualAnalyzer | undefined {
  const config = geminiVisualConfigFromEnv(inputs.env ?? process.env);
  if (!config) return undefined;

  return createGeminiVisualAnalyzer({ consolidator: inputs.consolidator, config });
}

function parseInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
