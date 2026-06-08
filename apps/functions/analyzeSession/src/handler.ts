// Pure analyzeSession core. No SDK imports so it stays unit-testable.
//
// Flow:
//   1. validate input (400 invalid_input)
//   2. find session (404 session_not_found)
//   3. require session.state == "completed" (409 session_not_completed)
//   4. find transcript + survey context (404 if missing)
//   5. call LLM via deps.analyzeWithLLM (500 with retry inside the adapter)
//   6. upsert AnalysisReport(scope=session) keyed by sessionId (idempotent)
//   7. return 200 { reportId, scope: "session" }

import {
  AnalyzeSessionRequestSchema,
  type AnalyzeSessionResponse,
  type AnalysisReportInput,
  type AnalysisReportOutput,
  type VisualAnalysisOutput,
} from "@merism/contracts";
import type { RecordingBytes, RecordingRecord, VisualAnalyzer } from "./visual-analysis.js";
import { calculateVideoSegmentSpecs } from "./video-segments.js";

export interface SessionRecord {
  $id: string;
  surveyId: string;
  state: "created" | "in_progress" | "completed" | "abandoned" | "failed";
  collectedAnswers: Record<string, unknown>;
}

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

export interface SurveyContext {
  surveyId: string;
  ownerUserId: string;
  title: string;
  flowConfig: Record<string, unknown>;
  sections: Array<{ $id: string; surveyId: string; title: string; description: string; order: number }>;
  questionBlocks: Array<{
    $id: string;
    surveyId: string;
    sectionId: string;
    order: number;
    orderInSection: number;
    type: string;
    prompt: string;
    config: Record<string, unknown>;
  }>;
}

export interface AnalyzeSessionDeps {
  findSession(id: string): Promise<SessionRecord | null>;
  findTranscript(sessionId: string): Promise<TranscriptRecord | null>;
  findSurveyContext(surveyId: string): Promise<SurveyContext | null>;
  /**
   * Adapter for the LLM call. The adapter MUST validate the LLM output
   * against AnalysisReportOutputSchema before returning. The handler trusts
   * the returned payload to be schema-valid.
   */
  analyzeWithLLM(input: AnalysisReportInput): Promise<AnalysisReportOutput>;
  findRecording?(sessionId: string): Promise<RecordingRecord | null>;
  getRecordingBytes?(recording: RecordingRecord): Promise<RecordingBytes>;
  analyzeRecordingVisuals?: VisualAnalyzer;
  /**
   * Upsert keyed by (scope=session, sessionId). Implementation is responsible
   * for "find existing or create new" — the handler simply trusts a single
   * row exists per (scope=session, sessionId) at any time.
   */
  upsertSessionReport(args: {
    sessionId: string;
    surveyId: string;
    ownerUserId: string;
    body: AnalysisReportOutput;
    generatedAt: string;
  }): Promise<{ reportId: string }>;
  now(): number;
}

export type AnalyzeSessionResult =
  | { status: 200; body: AnalyzeSessionResponse }
  | { status: 400 | 404 | 409 | 500; body: { error: string; traceId?: string } };

export async function analyzeSession(
  rawInput: unknown,
  deps: AnalyzeSessionDeps,
): Promise<AnalyzeSessionResult> {
  const parsed = AnalyzeSessionRequestSchema.safeParse(rawInput);
  if (!parsed.success) return { status: 400, body: { error: "invalid_input" } };
  const { sessionId } = parsed.data;

  const session = await deps.findSession(sessionId);
  if (!session) return { status: 404, body: { error: "session_not_found" } };
  if (session.state !== "completed") {
    return { status: 409, body: { error: "session_not_completed" } };
  }

  const transcript = await deps.findTranscript(sessionId);
  if (!transcript) return { status: 404, body: { error: "transcript_not_found" } };

  const survey = await deps.findSurveyContext(session.surveyId);
  if (!survey) return { status: 404, body: { error: "survey_not_found" } };

  const llmInput: AnalysisReportInput = {
    sessionId,
    survey: {
      title: survey.title,
      flowConfig: survey.flowConfig,
      sections: survey.sections.map((s) => ({
        $id: s.$id,
        surveyId: s.surveyId,
        title: s.title,
        description: s.description,
        order: s.order,
      })),
      questionBlocks: survey.questionBlocks.map((q) => ({
        $id: q.$id,
        surveyId: q.surveyId,
        sectionId: q.sectionId,
        order: q.order,
        orderInSection: q.orderInSection,
        type: q.type as any,
        prompt: q.prompt,
        config: q.config,
        probingPolicy: {},
        skipLogic: {},
      })),
    },
    transcript: { segments: transcript.segments },
    collectedAnswers: session.collectedAnswers,
  };

  let body: AnalysisReportOutput;
  try {
    body = await deps.analyzeWithLLM(llmInput);
  } catch {
    return { status: 500, body: { error: "llm_unavailable" } };
  }

  let visualAnalysis: VisualAnalysisOutput | null;
  try {
    visualAnalysis = await maybeAnalyzeRecordingVisuals({
      deps,
      sessionId,
      transcript,
    });
  } catch {
    return { status: 500, body: { error: "visual_analysis_failed" } };
  }
  if (visualAnalysis) {
    body = { ...body, visualAnalysis };
  }

  let saved: { reportId: string };
  try {
    saved = await deps.upsertSessionReport({
      sessionId,
      surveyId: session.surveyId,
      ownerUserId: survey.ownerUserId,
      body,
      generatedAt: new Date(deps.now()).toISOString(),
    });
  } catch {
    return { status: 500, body: { error: "persist_failed" } };
  }

  return {
    status: 200,
    body: { reportId: saved.reportId, scope: "session" },
  };
}

async function maybeAnalyzeRecordingVisuals({
  deps,
  sessionId,
  transcript,
}: {
  deps: AnalyzeSessionDeps;
  sessionId: string;
  transcript: TranscriptRecord;
}): Promise<VisualAnalysisOutput | null> {
  if (!deps.findRecording || !deps.getRecordingBytes || !deps.analyzeRecordingVisuals) {
    return null;
  }

  const recording = await deps.findRecording(sessionId);
  if (!recording) return null;

  const media = await deps.getRecordingBytes(recording);
  const segmentSpecs = calculateVideoSegmentSpecs(recording.durationMs, transcript);
  return deps.analyzeRecordingVisuals({
    sessionId,
    recording,
    transcript,
    media,
    segmentSpecs,
  });
}
