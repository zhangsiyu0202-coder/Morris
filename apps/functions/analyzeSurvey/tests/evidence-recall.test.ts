import { describe, expect, it } from "vitest";

import {
  recallEvidence,
  type RecallableEvidence,
} from "../src/evidence-recall.js";

const vector = (first: number, second: number): number[] => [first, second, ...Array.from({ length: 1022 }, () => 0)];

const evidence = (overrides: Partial<RecallableEvidence>): RecallableEvidence => ({
  $id: "evidence-default",
  transcriptId: "transcript-default",
  segmentIndex: 0,
  embeddingModel: "jina-embeddings-v5-text-small",
  embedding: vector(1, 0),
  ...overrides,
});

describe("research evidence recall", () => {
  it("returns bounded cosine-ranked candidates from the requested model only", () => {
    const candidates = recallEvidence({
      queryEmbedding: vector(1, 0),
      embeddingModel: "jina-embeddings-v5-text-small",
      limit: 2,
      evidence: [
        evidence({ $id: "far", transcriptId: "t3", embedding: vector(0, 1) }),
        evidence({ $id: "near", transcriptId: "t1", embedding: vector(0.9, 0.1) }),
        evidence({ $id: "other-model", transcriptId: "t2", embeddingModel: "qwen.text-embedding-v3" }),
      ],
    });

    expect(candidates.map((candidate) => candidate.evidence.$id)).toEqual(["near", "far"]);
    expect(candidates[0]?.similarity).toBeGreaterThan(candidates[1]?.similarity ?? 1);
  });

  it("is deterministic when equal similarities arrive in a different input order", () => {
    const first = evidence({ $id: "b", transcriptId: "tx-b", segmentIndex: 2, embedding: vector(1, 0) });
    const second = evidence({ $id: "a", transcriptId: "tx-a", segmentIndex: 5, embedding: vector(1, 0) });

    const rank = (rows: RecallableEvidence[]) => recallEvidence({
      queryEmbedding: vector(1, 0),
      embeddingModel: "jina-embeddings-v5-text-small",
      limit: 10,
      evidence: rows,
    }).map((candidate) => candidate.evidence.$id);

    expect(rank([first, second])).toEqual(["a", "b"]);
    expect(rank([second, first])).toEqual(["a", "b"]);
  });

  it("rejects malformed or zero-magnitude vectors rather than returning invented scores", () => {
    expect(() => recallEvidence({
      queryEmbedding: Array.from({ length: 1024 }, () => 0),
      embeddingModel: "jina-embeddings-v5-text-small",
      limit: 1,
      evidence: [evidence({ $id: "zero", embedding: Array.from({ length: 1024 }, () => 0) })],
    })).toThrow(/non-zero/);
  });
});
