import { JINA_EMBEDDING_DIMENSIONS } from "./embedder.js";

export interface RecallableEvidence {
  $id: string;
  transcriptId: string;
  segmentIndex: number;
  embeddingModel: string;
  embedding: readonly number[];
}

export interface EvidenceRecallResult {
  evidence: RecallableEvidence;
  similarity: number;
}

export interface RecallEvidenceInput {
  queryEmbedding: readonly number[];
  embeddingModel: string;
  evidence: readonly RecallableEvidence[];
  limit: number;
}

/**
 * Deterministic dense recall for the Appwrite-backed evidence corpus. It is
 * intentionally provider-free: callers validate the stored vector at the
 * persistence boundary, then this function enforces dimensions again before
 * a reranker sees any candidate.
 */
export function recallEvidence(input: RecallEvidenceInput): EvidenceRecallResult[] {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("recall limit must be a positive integer");
  }
  assertValidVector(input.queryEmbedding, "query embedding");

  return input.evidence
    .filter((evidence) => evidence.embeddingModel === input.embeddingModel)
    .map((evidence) => {
      assertValidVector(evidence.embedding, `evidence embedding ${evidence.$id}`);
      return { evidence, similarity: cosineSimilarity(input.queryEmbedding, evidence.embedding) };
    })
    .sort((left, right) =>
      right.similarity - left.similarity ||
      left.evidence.transcriptId.localeCompare(right.evidence.transcriptId) ||
      left.evidence.segmentIndex - right.evidence.segmentIndex ||
      left.evidence.$id.localeCompare(right.evidence.$id),
    )
    .slice(0, input.limit);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < JINA_EMBEDDING_DIMENSIONS; index++) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    throw new Error("embedding vectors must have non-zero magnitude");
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function assertValidVector(vector: readonly number[], label: string): void {
  if (
    vector.length !== JINA_EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`${label} must contain ${JINA_EMBEDDING_DIMENSIONS} finite values`);
  }
}
