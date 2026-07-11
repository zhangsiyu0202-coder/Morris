import { describe, it, expect } from "vitest";
import {
  SurveySchema,
  RecordingSchema,
  InterviewSessionSchema,
  AnalysisReportSchema,
} from "@merism/contracts";

// ADR 0006 tenancy fields are OPTIONAL during migration: existing rows that
// predate the migration must still parse, and migrated rows carry the fields.

describe("contracts: ADR 0006 tenancy fields are non-breaking", () => {
  it("Survey parses without tenancy fields (legacy row)", () => {
    const s = SurveySchema.parse({
      $id: "sv1", projectId: "p1", title: "T", updatedAt: "2026-06-11T00:00:00.000Z",
    });
    expect(s.workspaceId).toBeUndefined();
    expect(s.authorId).toBeUndefined();
  });

  it("Survey parses with tenancy fields (migrated row)", () => {
    const s = SurveySchema.parse({
      $id: "sv1", projectId: "p1", workspaceId: "ws_1", authorId: "u1",
      title: "T", updatedAt: "2026-06-11T00:00:00.000Z",
    });
    expect(s.workspaceId).toBe("ws_1");
    expect(s.authorId).toBe("u1");
  });

  it("Recording (ownerUserId-scoped) accepts workspaceId + authorId", () => {
    const r = RecordingSchema.parse({
      $id: "r1", sessionId: "s1", ownerUserId: "u1", workspaceId: "ws_1", authorId: "u1",
      storageFileId: "f1", durationMs: 1000, format: "mp4",
    });
    expect(r.workspaceId).toBe("ws_1");
  });

  it("InterviewSession (interviewee-facing) carries workspaceId but no authorId field set", () => {
    const sess = InterviewSessionSchema.parse({
      $id: "s1", surveyId: "sv1", linkId: "l1", workspaceId: "ws_1", livekitRoom: "room1",
    });
    expect(sess.workspaceId).toBe("ws_1");
  });

  it("AnalysisReport still enforces its scope superRefine with tenancy fields present", () => {
    expect(
      AnalysisReportSchema.safeParse({
        $id: "ar1", scope: "session", ownerUserId: "u1", workspaceId: "ws_1", authorId: "u1",
        generatedAt: "2026-06-11T00:00:00.000Z",
      }).success,
    ).toBe(false); // scope=session requires sessionId
  });
});
