import { describe, expect, it, vi } from "vitest";
import type { ResearchEvidence } from "@merism/contracts";
import { analyzeEvidence, type AnalyzeEvidenceDeps } from "../src/handler.js";

const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));

function makeDeps(overrides: Partial<AnalyzeEvidenceDeps> = {}) {
  const upsertEvidence = vi.fn(async (_records: ResearchEvidence[]) => undefined);
  const embedEvidence = vi.fn(async () => vector);
  const extractAtomicClaims = vi.fn(async () => ({
    claims: [{
      segmentIndex: 1,
      claim: "The customer lacks an internal rollout owner.",
      claimType: "barrier" as const,
      stance: "negative" as const,
    }],
  }));
  const deps: AnalyzeEvidenceDeps = {
    now: () => Date.UTC(2026, 6, 17),
    findSessionContext: async () => ({
      sessionId: "s1",
      surveyId: "survey-1",
      ownerUserId: "owner-1",
      workspaceId: "workspace-1",
      state: "completed",
      surveyTitle: "Adoption study",
      researchIntent: "Discover purchase barriers.",
    }),
    findTranscript: async () => ({
      $id: "transcript-1",
      sessionId: "s1",
      segments: [
        { speaker: "agent", startMs: 0, endMs: 10, text: "What blocks adoption?" },
        { speaker: "interviewee", startMs: 10, endMs: 20, text: "No one owns the rollout." },
      ],
    }),
    extractAtomicClaims,
    embedEvidence,
    evidenceIdentity: () => ({ $id: "ev_a", contentHash: "a".repeat(64) }),
    upsertEvidence,
    ...overrides,
  };
  return { deps, upsertEvidence, embedEvidence, extractAtomicClaims };
}

describe("analyzeEvidence handler", () => {
  it("indexes only validated respondent-backed claims as passage embeddings", async () => {
    const { deps, upsertEvidence, embedEvidence } = makeDeps();
    const result = await analyzeEvidence({ sessionId: "s1" }, deps);
    expect(result).toEqual({ status: 200, body: { sessionId: "s1", indexedCount: 1 } });
    expect(embedEvidence).toHaveBeenCalledWith(expect.objectContaining({ task: "retrieval.passage" }));
    const record = upsertEvidence.mock.calls[0][0][0] as ResearchEvidence;
    expect(record).toMatchObject({
      $id: "ev_a",
      transcriptId: "transcript-1",
      segmentIndex: 1,
      questionText: "What blocks adoption?",
      sourceText: "No one owns the rollout.",
      claimType: "barrier",
      stance: "negative",
      embeddingModel: "jina-embeddings-v5-text-small",
    });
    expect(record.embedding).toHaveLength(1024);
  });

  it("rejects source-less model output before embedding or persistence", async () => {
    const { deps, upsertEvidence, embedEvidence } = makeDeps({
      extractAtomicClaims: async () => ({
        claims: [{
          segmentIndex: 0,
          claim: "The moderator asked about adoption.",
          claimType: "other",
          stance: "neutral",
        }],
      }),
    });
    const result = await analyzeEvidence({ sessionId: "s1" }, deps);
    expect(result).toEqual({ status: 500, body: { error: "claim_extraction_failed" } });
    expect(embedEvidence).not.toHaveBeenCalled();
    expect(upsertEvidence).not.toHaveBeenCalled();
  });

  it("does not index a session that is not complete", async () => {
    const { deps, extractAtomicClaims } = makeDeps({
      findSessionContext: async () => ({
        sessionId: "s1",
        surveyId: "survey-1",
        ownerUserId: "owner-1",
        state: "in_progress",
        surveyTitle: "Adoption study",
        researchIntent: "",
      }),
    });
    const result = await analyzeEvidence({ sessionId: "s1" }, deps);
    expect(result).toEqual({ status: 409, body: { error: "session_not_completed" } });
    expect(extractAtomicClaims).not.toHaveBeenCalled();
  });
});
