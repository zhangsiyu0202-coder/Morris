import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  VisualAnalysisJobSchema,
  VisualAnalysisJobStatus,
  VISUAL_ANALYSIS_JOB_TERMINAL_STATUSES,
  visualAnalysisJobId,
  AnalyzeSessionVisualRequestSchema,
  AnalyzeSessionVisualResponseSchema,
} from "@merism/contracts";

describe("contracts: VisualAnalysisJob (ADR 0005)", () => {
  it("applies documented defaults for a freshly-queued job", () => {
    const parsed = VisualAnalysisJobSchema.parse({
      $id: "vis_s1",
      sessionId: "s1",
      surveyId: "sv1",
      ownerUserId: "u1",
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-11T00:00:00.000Z",
    });
    expect(parsed.status).toBe("queued");
    expect(parsed.geminiFileName).toBeNull();
    expect(parsed.geminiUploadedAt).toBeNull();
    expect(parsed.attemptCount).toBe(0);
    expect(parsed.errorContext).toBeNull();
  });

  it("round-trips for every status with a tracked file", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VisualAnalysisJobStatus.options),
        fc.string({ minLength: 1 }),
        (status, sessionId) => {
          const row = {
            $id: visualAnalysisJobId(sessionId),
            sessionId,
            surveyId: "sv1",
            ownerUserId: "u1",
            status,
            geminiFileName: "files/abc",
            geminiUploadedAt: "2026-06-11T00:00:00.000Z",
            attemptCount: 1,
            errorContext: { reason: "x" },
            createdAt: "2026-06-11T00:00:00.000Z",
            updatedAt: "2026-06-11T00:00:00.000Z",
          };
          const once = VisualAnalysisJobSchema.parse(row);
          const twice = VisualAnalysisJobSchema.parse(once);
          expect(twice).toEqual(once);
        },
      ),
    );
  });

  it("derives a deterministic id (the dedup gate)", () => {
    expect(visualAnalysisJobId("abc")).toBe("vis_abc");
    expect(visualAnalysisJobId("abc")).toBe(visualAnalysisJobId("abc"));
  });

  it("terminal statuses are a subset of the status enum", () => {
    for (const s of VISUAL_ANALYSIS_JOB_TERMINAL_STATUSES) {
      expect(VisualAnalysisJobStatus.options).toContain(s);
    }
  });

  it("rejects an unknown status", () => {
    expect(
      VisualAnalysisJobSchema.safeParse({
        $id: "vis_s1",
        sessionId: "s1",
        surveyId: "sv1",
        ownerUserId: "u1",
        status: "bogus",
        createdAt: "2026-06-11T00:00:00.000Z",
        updatedAt: "2026-06-11T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("validates the analyzeSessionVisual request/response shapes", () => {
    expect(AnalyzeSessionVisualRequestSchema.safeParse({ sessionId: "" }).success).toBe(false);
    expect(AnalyzeSessionVisualRequestSchema.safeParse({ sessionId: "s1" }).success).toBe(true);
    const res = AnalyzeSessionVisualResponseSchema.parse({
      jobId: "vis_s1",
      status: "queued",
      claimed: true,
    });
    expect(res).toMatchObject({ jobId: "vis_s1", status: "queued", claimed: true });
  });
});
