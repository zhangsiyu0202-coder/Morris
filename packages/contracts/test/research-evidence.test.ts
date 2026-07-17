import { describe, expect, it } from "vitest";

import { ResearchEvidenceSchema } from "@merism/contracts";

const now = new Date().toISOString();
const embedding = Array.from({ length: 1024 }, (_, index) => index / 1024);

const validEvidence = {
  $id: "evidence_1",
  ownerUserId: "researcher_1",
  surveyId: "survey_1",
  sessionId: "session_1",
  transcriptId: "transcript_1",
  segmentIndex: 3,
  questionId: "question_2",
  questionText: "What stopped you from buying?",
  sourceText: "The budget was approved, but nobody owned implementation.",
  claim: "Purchase stalled because the customer lacked an implementation owner.",
  claimType: "barrier",
  stance: "negative",
  participantRole: "IT leader",
  participantIndustry: "manufacturing",
  participantCompanySize: "100-500",
  purchaseStatus: "not_purchased",
  embedding: JSON.stringify(embedding),
  embeddingModel: "jina-embeddings-v5-text-small",
  contentHash: "a".repeat(64),
  createdAt: now,
};

describe("ResearchEvidenceSchema", () => {
  it("normalizes an Appwrite JSON embedding while retaining its transcript source", () => {
    const parsed = ResearchEvidenceSchema.parse(validEvidence);

    expect(parsed.embedding).toEqual(embedding);
    expect(parsed.transcriptId).toBe("transcript_1");
    expect(parsed.segmentIndex).toBe(3);
  });

  it("rejects evidence without a valid 1024-dimensional finite embedding", () => {
    expect(
      ResearchEvidenceSchema.safeParse({ ...validEvidence, embedding: embedding.slice(0, 1023) }).success,
    ).toBe(false);
    expect(
      ResearchEvidenceSchema.safeParse({
        ...validEvidence,
        embedding: Array.from({ length: 1024 }, () => Number.NaN),
      }).success,
    ).toBe(false);
  });

  it("rejects blank claims and invalid source references", () => {
    expect(ResearchEvidenceSchema.safeParse({ ...validEvidence, claim: "   " }).success).toBe(false);
    expect(ResearchEvidenceSchema.safeParse({ ...validEvidence, segmentIndex: -1 }).success).toBe(false);
  });
});
