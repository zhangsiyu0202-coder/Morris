// Pure core for analyzeSessionVisual (ADR 0005). No SDK imports — fully
// unit-testable with in-memory deps.
//
// Flow:
//   1. validate input (400 invalid_input)
//   2. resolve {surveyId, ownerUserId} for the session (404 session_not_found)
//   3. claim the job via deterministic id 409-CAS (D3): a non-terminal job
//      already owned by a concurrent run => dedup skip (claimed:false)
//   4. no recording => succeeded no-op; no transcript => failed (recorded on row)
//   5. run the visual pipeline; failure is recorded on the job row, NOT a 500
//      (this is an async job — the text report already shipped)
//   6. patch visualAnalysis back into AnalysisReport(scope=session)
//   7. mark job succeeded
//
// The Function never returns 5xx for an analysis failure; the job row's status
// + errorContext is the failure surface (D1). Only malformed input (400) and a
// missing session (404) are non-200.

import {
  AnalyzeSessionVisualRequestSchema,
  type AnalyzeSessionVisualResponse,
  type VisualAnalysisJobStatusValue,
  type VisualAnalysisOutput,
  visualAnalysisJobId,
} from "@merism/contracts";
import type {
  RecordingBytes,
  RecordingRecord,
  VisualAnalyzer,
} from "./visual-analysis.js";
import { calculateVideoSegmentSpecs } from "./video-segments.js";

export interface TranscriptRecord {
  $id: string;
  sessionId: string;
  segments: Array<{
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
  }>;
  language: string;
}

export interface VisualJobContext {
  surveyId: string;
  ownerUserId: string;
}

export interface ClaimResult {
  /** true when this invocation owns the job; false when a concurrent run does. */
  claimed: boolean;
  status: VisualAnalysisJobStatusValue;
}

export interface AnalyzeSessionVisualDeps {
  /** Resolve the owning survey + owner for the session. Null if session/survey missing. */
  findJobContext(sessionId: string): Promise<VisualJobContext | null>;
  /**
   * Claim the job via deterministic `$id` (`vis_<sessionId>`) create with
   * Appwrite 409 acting as CAS (architecture concurrency contract). Creates a
   * fresh `queued` row, OR resets a TERMINAL row to `queued` (researcher re-run)
   * and reports claimed=true. When a NON-terminal row already exists, reports
   * claimed=false with that row's current status (a concurrent run owns it).
   */
  claimJob(input: {
    sessionId: string;
    surveyId: string;
    ownerUserId: string;
    now: string;
  }): Promise<ClaimResult>;
  findRecording(sessionId: string): Promise<RecordingRecord | null>;
  findTranscript(sessionId: string): Promise<TranscriptRecord | null>;
  getRecordingBytes(recording: RecordingRecord): Promise<RecordingBytes>;
  /** The Gemini visual pipeline. Real deps bind the onFileUploaded hook to the job row. */
  analyzeRecordingVisuals: VisualAnalyzer;
  setJobStatus(
    sessionId: string,
    status: VisualAnalysisJobStatusValue,
    patch?: { errorContext?: Record<string, unknown> },
  ): Promise<void>;
  /** Patch visualAnalysis into the existing AnalysisReport(scope=session) row. */
  patchReportVisualAnalysis(sessionId: string, visual: VisualAnalysisOutput): Promise<void>;
  now(): number;
}

export type AnalyzeSessionVisualResult =
  | { status: 200; body: AnalyzeSessionVisualResponse }
  | { status: 400 | 404; body: { error: string; traceId?: string } };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function analyzeSessionVisual(
  rawInput: unknown,
  deps: AnalyzeSessionVisualDeps,
): Promise<AnalyzeSessionVisualResult> {
  const parsed = AnalyzeSessionVisualRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { sessionId } = parsed.data;
  const jobId = visualAnalysisJobId(sessionId);

  const ctx = await deps.findJobContext(sessionId);
  if (!ctx) return { status: 404, body: { error: "session_not_found" } };

  const claim = await deps.claimJob({
    sessionId,
    surveyId: ctx.surveyId,
    ownerUserId: ctx.ownerUserId,
    now: new Date(deps.now()).toISOString(),
  });
  if (!claim.claimed) {
    // Dedup loser (ADR 0005 D3): a concurrent run owns the in-flight job.
    return { status: 200, body: { jobId, status: claim.status, claimed: false } };
  }

  const recording = await deps.findRecording(sessionId);
  if (!recording) {
    // No visual recording to analyze — terminal success, nothing patched.
    await deps.setJobStatus(sessionId, "succeeded");
    return { status: 200, body: { jobId, status: "succeeded", claimed: true } };
  }

  const transcript = await deps.findTranscript(sessionId);
  if (!transcript) {
    await deps.setJobStatus(sessionId, "failed", {
      errorContext: { reason: "transcript_not_found" },
    });
    return { status: 200, body: { jobId, status: "failed", claimed: true } };
  }

  try {
    const media = await deps.getRecordingBytes(recording);
    const segmentSpecs = calculateVideoSegmentSpecs(recording.durationMs, transcript);
    const visual = await deps.analyzeRecordingVisuals({
      sessionId,
      recording,
      transcript,
      media,
      segmentSpecs,
    });
    await deps.patchReportVisualAnalysis(sessionId, visual);
  } catch (err) {
    await deps.setJobStatus(sessionId, "failed", { errorContext: { reason: errMsg(err) } });
    return { status: 200, body: { jobId, status: "failed", claimed: true } };
  }

  await deps.setJobStatus(sessionId, "succeeded");
  return { status: 200, body: { jobId, status: "succeeded", claimed: true } };
}
