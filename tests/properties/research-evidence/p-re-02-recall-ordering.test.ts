import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { recallEvidence } from "../../../apps/functions/analyzeSurvey/src/evidence-recall.js";

const vector = (first: number, second: number): number[] => [
  first,
  second,
  ...Array.from({ length: 1022 }, () => 0),
];

describe("P-RE-02: evidence recall ordering", () => {
  it("returns at most the requested limit with deterministic descending similarities", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 1, max: 20 }),
        (firstCoordinates, limit) => {
          const evidence = firstCoordinates.map((first, index) => ({
            $id: `evidence-${index}`,
            transcriptId: `transcript-${index}`,
            segmentIndex: index,
            embeddingModel: "jina-embeddings-v5-text-small",
            embedding: vector(first, 1),
          }));
          const results = recallEvidence({
            queryEmbedding: vector(1, 0),
            embeddingModel: "jina-embeddings-v5-text-small",
            evidence,
            limit,
          });

          expect(results.length).toBeLessThanOrEqual(Math.min(limit, evidence.length));
          for (let index = 1; index < results.length; index++) {
            expect(results[index - 1]!.similarity).toBeGreaterThanOrEqual(results[index]!.similarity);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
