import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/cosine";

describe("cosineSimilarity", () => {
  it("parallel vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it("antiparallel vectors → -1", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("identical vectors → 1", () => {
    const v = [0.1, 0.5, -0.3, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("dimension mismatch throws", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension mismatch/);
  });

  it("empty vectors → 0 (no error)", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
