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
  type GenerationMeta,
  type SessionQualityFlag,
} from "@merism/contracts";
import { buildValidRefs, checkHallucinationRatio } from "./hallucination.js";
import { deriveQualityFlags } from "./quality-flags.js";
import { HALLUCINATION_RATIO_THRESHOLD } from "./constants.js";
import { PROMPT_VERSION } from "./prompts/version.js";

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
   *
   * `opts.hallucinationHint`: when present, the adapter prepends a reflection
   * paragraph to the user prompt (system prompt unchanged, prompt-cache safe).
   * See analysis-report-v2 design §6.3.
   */
  analyzeWithLLM(
    input: AnalysisReportInput,
    opts?: {
      hallucinationHint?: { badRefs: Array<{ transcriptId: string; segmentIndex: number }> };
    },
  ): Promise<AnalysisReportOutput>;
  /**
   * Durable trigger for the visual pipeline (ADR 0005 D1): create the
   * `visual_analysis_jobs` row in `queued` state (idempotent; 409 = already
   * exists). Called before enqueue so a dropped async execution still leaves a
   * row the reaper can re-fire. Optional — omitted when the feature is off.
   */
  ensureVisualJobQueued?(input: {
    sessionId: string;
    surveyId: string;
    ownerUserId: string;
  }): Promise<void>;
  /**
   * Best-effort enqueue of the async post-session visual pipeline
   * (analyzeSessionVisual Function, ADR 0005 D1). Called after the text report
   * is persisted so the visual job has a row to patch. Failure MUST NOT fail
   * the text analysis. Optional — deployments without the visual feature omit it.
   */
  enqueueVisualAnalysis?(sessionId: string): Promise<void>;
  /**
   * LLM-based qualityFlags derivation (semantic flags subset). Mechanical
   * flags are derived in `quality-flags.ts` outside this dep; the handler
   * merges both and enforces mutex per design §5.
   */
  deriveQualityFlagsWithLLM(input: {
    transcript: TranscriptRecord;
    surveyContext: SurveyContext;
  }): Promise<{ flags: SessionQualityFlag[] }>;
  /**
   * Best-effort writeback of qualityFlags to the InterviewSession document.
   * Failure here MUST NOT fail the analysis (D6).
   */
  updateInterviewSessionFlags(
    sessionId: string,
    flags: SessionQualityFlag[],
  ): Promise<void>;
  /**
   * Write a structured error context to InterviewSession when analysis is
   * rejected (e.g. hallucination threshold exceeded after retry). Used by
   * the v2 reject path (R3).
   */
  updateSessionErrorContext(
    sessionId: string,
    ctx: {
      reason: string;
      ratio?: number;
      attemptCount?: number;
      badRefs?: Array<{ transcriptId: string; segmentIndex: number }>;
      promptVersion?: string;
    },
  ): Promise<void>;
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
    /** Optional v2 generation metadata (analysis-report-v2 R2). */
    generationMeta?: GenerationMeta;
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

  // analysis-report-v2 R3: hallucination ratio reject + retry once
  // (design §6). validRefs 由 transcript.segments 数算; LLM 输出的 segmentRef
  // 必须落在这个集合内, 否则视为幻觉。
  // transcriptId 与 deps.analyzeWithLLM 的 buildSessionAnalyzeUserPrompt 中一致 — 用 sessionId。
  const validRefs = buildValidRefs(sessionId, transcript.segments.length);

  let body: AnalysisReportOutput;
  let attemptCount = 0;
  let hallucinationCheck:
    | { ratio: number; ok: boolean; totalRefs: number; badRefs: { transcriptId: string; segmentIndex: number }[] }
    | undefined;
  let lastBadRefs: { transcriptId: string; segmentIndex: number }[] = [];

  for (attemptCount = 1; attemptCount <= 2; attemptCount++) {
    try {
      body = await deps.analyzeWithLLM(
        llmInput,
        attemptCount === 2 ? { hallucinationHint: { badRefs: lastBadRefs } } : undefined,
      );
    } catch {
      return { status: 500, body: { error: "llm_unavailable" } };
    }
    hallucinationCheck = checkHallucinationRatio({
      themes: body.themes,
      citations: body.citations,
      validRefs,
      threshold: HALLUCINATION_RATIO_THRESHOLD,
    });
    if (hallucinationCheck.ok) break;
    lastBadRefs = hallucinationCheck.badRefs;
  }

  // body 由循环写入; TS 控制流分析在保证 ok=true 出循环时可见, 但用 ! 显式断言
  // 来避免"在 break 之前 body 可能未赋值"的疑虑。逻辑上等价。
  body = body!;

  if (!hallucinationCheck!.ok) {
    // R3.4: reject without writing dirty data (D4).
    try {
      await deps.updateSessionErrorContext(sessionId, {
        reason: "hallucination_threshold_exceeded",
        ratio: hallucinationCheck!.ratio,
        attemptCount,
        badRefs: hallucinationCheck!.badRefs.slice(0, 10),
        promptVersion: PROMPT_VERSION,
      });
    } catch {
      // best-effort: 即使写 errorContext 失败也要 reject, 不让脏数据落库。
    }
    return {
      status: 409,
      body: { error: "analysis_rejected" },
    };
  }

  // analysis-report-v2 R1: derive qualityFlags (规则 + LLM 混合) + R2: write generationMeta.
  const totalDurationMs = transcript.segments.length
    ? transcript.segments[transcript.segments.length - 1].endMs
    : 0;
  const qualityFlags = await deriveQualityFlags({
    transcript,
    surveyContext: survey,
    totalDurationMs,
    llm: deps.deriveQualityFlagsWithLLM,
  });

  const generationMeta: GenerationMeta = {
    promptVersion: PROMPT_VERSION,
    attemptCount,
    hallucinationRatio: hallucinationCheck!.ratio,
    createdWith: [
      { stage: "session-main", model: "deepseek-chat" },
      { stage: "quality-flags", model: "deepseek-chat" },
    ],
  };

  let saved: { reportId: string };
  try {
    saved = await deps.upsertSessionReport({
      sessionId,
      surveyId: session.surveyId,
      ownerUserId: survey.ownerUserId,
      body,
      generatedAt: new Date(deps.now()).toISOString(),
      generationMeta,
    });
  } catch {
    return { status: 500, body: { error: "persist_failed" } };
  }

  // R1 D6: best-effort writeback of qualityFlags. Failure logs warn, doesn't fail analysis.
  try {
    await deps.updateInterviewSessionFlags(sessionId, qualityFlags);
  } catch {
    // intentional swallow — D6
  }

  // ADR 0005 D1: durable trigger. Create the queued job row FIRST so a dropped
  // async execution still leaves a row the reaper (sweepGeminiFiles) can re-fire,
  // then fire the async execution. Both best-effort — visual never fails the text
  // path (the text report has already been persisted).
  if (deps.ensureVisualJobQueued) {
    try {
      await deps.ensureVisualJobQueued({
        sessionId,
        surveyId: session.surveyId,
        ownerUserId: survey.ownerUserId,
      });
    } catch {
      // intentional swallow — runner's claim path can still create the row.
    }
  }
  if (deps.enqueueVisualAnalysis) {
    try {
      await deps.enqueueVisualAnalysis(sessionId);
    } catch {
      // intentional swallow — the durable queued row + reaper will re-drive it.
    }
  }

  return {
    status: 200,
    body: { reportId: saved.reportId, scope: "session" },
  };
}
