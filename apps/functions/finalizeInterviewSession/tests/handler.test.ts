import { describe, expect, it, vi } from "vitest";
import {
  finalizeInterviewSession,
  type FinalizeInterviewSessionDeps,
} from "../src/handler";

function makeDeps(over: Partial<FinalizeInterviewSessionDeps> = {}): FinalizeInterviewSessionDeps {
  return {
    nowIso: () => "2026-07-04T00:00:00.000Z",
    resolveSurveyTenancy: vi.fn(async () => ({ ownerUserId: "u1", workspaceId: "ws1" })),
    upsertTranscript: vi.fn(async () => {}),
    deleteTranscript: vi.fn(async () => {}),
    completeSession: vi.fn(async () => {}),
    upsertRecording: vi.fn(async () => {}),
    createUsageEvent: vi.fn(async () => {}),
    triggerPostSessionAnalysis: vi.fn(async () => {}),
    ...over,
  };
}

const REQUEST = {
  sessionId: "sess1",
  surveyId: "sv1",
  state: "completed" as const,
  collectedAnswers: { q1: { answer: "yes" } },
  transcript: {
    segments: [{ speaker: "respondent", startMs: 0, endMs: 10, text: "yes" }],
    language: "zh",
  },
  durationMs: 90_000,
  answeredCount: 1,
};

describe("finalizeInterviewSession", () => {
  it("persists transcript + session, emits usage, and triggers analysis on completed sessions", async () => {
    const deps = makeDeps();
    const result = await finalizeInterviewSession(REQUEST, deps);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sessionId: "sess1", state: "completed" });
    expect(deps.upsertTranscript).toHaveBeenCalledOnce();
    expect(deps.completeSession).toHaveBeenCalledWith({
      sessionId: "sess1",
      state: "completed",
      collectedAnswers: REQUEST.collectedAnswers,
      endedAt: "2026-07-04T00:00:00.000Z",
    });
    expect(deps.createUsageEvent).toHaveBeenCalledOnce();
    expect(deps.triggerPostSessionAnalysis).toHaveBeenCalledWith("sess1", "sv1");
    expect(deps.upsertRecording).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid input before side effects", async () => {
    const deps = makeDeps();
    const result = await finalizeInterviewSession({ sessionId: "sess1" }, deps);

    expect(result.status).toBe(400);
    expect(deps.upsertTranscript).not.toHaveBeenCalled();
    expect(deps.completeSession).not.toHaveBeenCalled();
  });

  it("rolls back transcript when session completion fails", async () => {
    const deps = makeDeps({
      completeSession: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const result = await finalizeInterviewSession(REQUEST, deps);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "internal_error" });
    expect(deps.deleteTranscript).toHaveBeenCalledWith("sess1");
  });

  it("does not emit usage or analysis for abandoned sessions", async () => {
    const deps = makeDeps();
    const result = await finalizeInterviewSession({ ...REQUEST, state: "abandoned" }, deps);

    expect(result.status).toBe(200);
    expect(deps.createUsageEvent).not.toHaveBeenCalled();
    expect(deps.triggerPostSessionAnalysis).not.toHaveBeenCalled();
  });

  it("persists recording metadata when present", async () => {
    const deps = makeDeps();
    const result = await finalizeInterviewSession({
      ...REQUEST,
      recording: {
        ownerUserId: "u1",
        workspaceId: "ws1",
        storageFileId: "sess1",
        durationMs: 90_000,
        format: "mp4" as const,
      },
    }, deps);

    expect(result.status).toBe(200);
    expect(deps.upsertRecording).toHaveBeenCalledWith({
      sessionId: "sess1",
      ownerUserId: "u1",
      workspaceId: "ws1",
      storageFileId: "sess1",
      durationMs: 90_000,
      format: "mp4",
    });
  });

  it("treats usage-event and analysis dispatch as best-effort", async () => {
    const deps = makeDeps({
      createUsageEvent: vi.fn(async () => {
        throw new Error("conflict");
      }),
      triggerPostSessionAnalysis: vi.fn(async () => {
        throw new Error("queue down");
      }),
    });
    const result = await finalizeInterviewSession(REQUEST, deps);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sessionId: "sess1", state: "completed" });
  });
});
