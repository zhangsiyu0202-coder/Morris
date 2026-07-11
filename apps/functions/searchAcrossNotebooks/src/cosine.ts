/**
 * Cosine similarity for fixed-length numeric vectors.
 *
 * Used by the searchAcrossNotebooks brute-force ranker (Wave E T37).
 *
 * Convention: returns a value in [-1, 1]. Returns 0 when either vector is
 * zero-length (cannot meaningfully compare).
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (a=${a.length}, b=${b.length})`,
    );
  }
  if (a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
