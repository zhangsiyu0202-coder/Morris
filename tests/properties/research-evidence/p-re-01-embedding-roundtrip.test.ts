import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ResearchEvidenceSchema } from "@merism/contracts";

describe("P-RE-01: research evidence embedding round-trip", () => {
  it("parses every valid 1024-dimensional finite vector idempotently", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1024,
          maxLength: 1024,
        }),
        (embedding) => {
          const input = {
            $id: "evidence_1",
            ownerUserId: "researcher_1",
            surveyId: "survey_1",
            sessionId: "session_1",
            transcriptId: "transcript_1",
            segmentIndex: 0,
            sourceText: "Participant described an implementation barrier.",
            claim: "Implementation ownership is unclear.",
            claimType: "barrier",
            stance: "negative",
            embedding,
            embeddingModel: "jina-embeddings-v5-text-small",
            contentHash: "a".repeat(64),
            createdAt: "2026-07-17T00:00:00.000Z",
          };
          const first = ResearchEvidenceSchema.parse(input);

          expect(ResearchEvidenceSchema.parse(first)).toEqual(first);
        },
      ),
      { numRuns: 20 },
    );
  });
});
