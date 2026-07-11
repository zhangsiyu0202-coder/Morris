import { describe, expect, it, vi } from "vitest";
import type { VisualAnalysisOutput } from "@merism/contracts";
import {
  analyzeSessionVisual,
  type AnalyzeSessionVisualDeps,
  type ClaimResult,
  type TranscriptRecord,
} from "../src/handler";
import type { RecordingRecord } from "../src/visual-analysis";

const recording: RecordingRecord = {
  $id: "rec1",
  sessionId: "sess1",
  ownerUserId: "u1",
  storageFileId: "file-sess1",
  durationMs: 62_000,
  format: "webm",
};

const transcript: TranscriptRecord = {
  $id: "tr1",
  sessionId: "sess1",
  language: "zh",
  segments: [{ speaker: "interviewee", startMs: 0, endMs: 1_000, text: "你好。" }],
};

const visualOutput: VisualAnalysisOutput = {
  source: "recording",
  recordingFileId: "file-sess1",
  durationMs: 62_000,
  visualConfirmation: true,
  summary: "整体平稳。",
  sentiment: "neutral",
  frustrationScore: 0,
  outcome: "successful",
  sentimentSignals: [],
  tags: ["engaged"],
  tagsFixed: [],
  tagsFreeform: [],
  highlighted: false,
  segments: [],
  keyMoments: [],
};

interface Overrides {
  context?: { surveyId: string; ownerUserId: string } | null;
  claim?: ClaimResult;
  recording?: RecordingRecord | null;
  transcript?: TranscriptRecord | null;
  analyze?: () => Promise<VisualAnalysisOutput>;
}

function makeDeps(overrides: Overrides = {}) {
  const setJobStatus = vi.fn(async () => undefined);
  const patchReport = vi.fn(async () => undefined);
  const analyzeSpy = vi.fn(overrides.analyze ?? (async () => visualOutput));
  const deps: AnalyzeSessionVisualDeps = {
    now: () => Date.UTC(2026, 5, 11, 0, 0, 0),
    findJobContext: async () =>
      "context" in overrides ? overrides.context! : { surveyId: "sv1", ownerUserId: "u1" },
    claimJob: async () => overrides.claim ?? { claimed: true, status: "queued" },
    findRecording: async () => ("recording" in overrides ? overrides.recording! : recording),
    findTranscript: async () => ("transcript" in overrides ? overrides.transcript! : transcript),
    getRecordingBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "video/webm" }),
    analyzeRecordingVisuals: analyzeSpy,
    setJobStatus,
    patchReportVisualAnalysis: patchReport,
  };
  return Object.assign(deps, { setJobStatus, patchReport, analyzeSpy });
}

describe("analyzeSessionVisual handler", () => {
  it("rejects invalid input with 400", async () => {
    const result = await analyzeSessionVisual({}, makeDeps());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_input" });
  });

  it("returns 404 when the session/survey context is missing", async () => {
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, makeDeps({ context: null }));
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: "session_not_found" });
  });

  it("dedup: skips when a concurrent run already owns a non-terminal job (claimed=false)", async () => {
    const deps = makeDeps({ claim: { claimed: false, status: "analyzing" } });
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ jobId: "vis_sess1", status: "analyzing", claimed: false });
    expect(deps.analyzeSpy).not.toHaveBeenCalled();
    expect(deps.setJobStatus).not.toHaveBeenCalled();
  });

  it("no recording => terminal success, nothing analyzed or patched", async () => {
    const deps = makeDeps({ recording: null });
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "succeeded", claimed: true });
    expect(deps.setJobStatus).toHaveBeenCalledWith("sess1", "succeeded");
    expect(deps.analyzeSpy).not.toHaveBeenCalled();
    expect(deps.patchReport).not.toHaveBeenCalled();
  });

  it("missing transcript => failed with errorContext, no analysis", async () => {
    const deps = makeDeps({ transcript: null });
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "failed", claimed: true });
    expect(deps.setJobStatus).toHaveBeenCalledWith("sess1", "failed", {
      errorContext: { reason: "transcript_not_found" },
    });
    expect(deps.analyzeSpy).not.toHaveBeenCalled();
  });

  it("happy path: analyzes, patches the report, marks succeeded", async () => {
    const deps = makeDeps();
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ jobId: "vis_sess1", status: "succeeded", claimed: true });
    expect(deps.analyzeSpy).toHaveBeenCalledTimes(1);
    expect(deps.patchReport).toHaveBeenCalledWith("sess1", visualOutput);
    expect(deps.setJobStatus).toHaveBeenLastCalledWith("sess1", "succeeded");
  });

  it("analyzer failure is recorded on the job row, not raised as 5xx", async () => {
    const deps = makeDeps({
      analyze: async () => {
        throw new Error("gemini upstream 503");
      },
    });
    const result = await analyzeSessionVisual({ sessionId: "sess1" }, deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "failed", claimed: true });
    expect(deps.patchReport).not.toHaveBeenCalled();
    const failCall = (deps.setJobStatus.mock.calls as any[]).find((c) => c[1] === "failed");
    expect(failCall?.[2]).toMatchObject({ errorContext: { reason: "gemini upstream 503" } });
  });
});
