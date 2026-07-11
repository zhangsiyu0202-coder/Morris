import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { cosineSimilarity } from "../../../apps/functions/searchAcrossNotebooks/src/cosine";

/**
 * P-NB-04 — embedding cosine stability + ranking determinism.
 *
 * 锁定: cosineSimilarity 是纯数学函数, 没有隐藏 state — 在固定 query 向量 +
 * 一组 notebook 向量集 (mock Qwen 注入) 下, 排序结果一定 deterministic;
 * 同一 textContent 的两个 notebook (向量相同) → score=1; 完全无关
 * (orthogonal) → score=0; 反向 → score=-1.
 *
 * 这是 Wave E searchAcrossStudies 排序稳定性的数学根基; 任何 ranker 重构
 * 必须保持这些不变量.
 */

const dim = 64; // smaller-than-real-1024 for speed; algebra identical

const fixedVecArb = fc.array(fc.float({ noNaN: true, noDefaultInfinity: true, min: -1, max: 1 }), {
  minLength: dim,
  maxLength: dim,
});

describe("P-NB-04: cosine similarity is stable + deterministic", () => {
  it("same vector → score 1 (within float tolerance)", () => {
    fc.assert(
      fc.property(fixedVecArb, (v) => {
        // Skip zero vectors (cosine returns 0 for those by convention)
        const isZero = v.every((x) => x === 0);
        fc.pre(!isZero);
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
      }),
    );
  });

  it("scaled-up parallel vector → score 1", () => {
    fc.assert(
      fc.property(fixedVecArb, fc.integer({ min: 1, max: 100 }), (v, scaleInt) => {
        const isZero = v.every((x) => x === 0);
        fc.pre(!isZero);
        const scale = scaleInt; // positive integer scaling preserves direction
        const scaled = v.map((x) => x * scale);
        expect(cosineSimilarity(v, scaled)).toBeCloseTo(1, 5);
      }),
    );
  });

  it("antiparallel vector → score -1", () => {
    fc.assert(
      fc.property(fixedVecArb, (v) => {
        const isZero = v.every((x) => x === 0);
        fc.pre(!isZero);
        const neg = v.map((x) => -x);
        expect(cosineSimilarity(v, neg)).toBeCloseTo(-1, 5);
      }),
    );
  });

  it("score is in [-1, 1] for any pair of non-zero vectors", () => {
    fc.assert(
      fc.property(fixedVecArb, fixedVecArb, (a, b) => {
        const aZero = a.every((x) => x === 0);
        const bZero = b.every((x) => x === 0);
        fc.pre(!aZero && !bZero);
        const score = cosineSimilarity(a, b);
        // small float slack outside [-1, 1] tolerated
        expect(score).toBeGreaterThanOrEqual(-1.000001);
        expect(score).toBeLessThanOrEqual(1.000001);
      }),
    );
  });

  it("ranking is deterministic — same inputs → same sorted order", () => {
    fc.assert(
      fc.property(
        fixedVecArb,
        fc.array(fixedVecArb, { minLength: 2, maxLength: 8 }),
        (query, vectors) => {
          const isZero = (v: number[]) => v.every((x) => x === 0);
          fc.pre(!isZero(query) && vectors.every((v) => !isZero(v)));
          const score1 = vectors.map((v, i) => ({ i, s: cosineSimilarity(query, v) }));
          const score2 = vectors.map((v, i) => ({ i, s: cosineSimilarity(query, v) }));
          expect(score2).toEqual(score1);
          const sorted1 = [...score1].sort((a, b) => b.s - a.s).map((x) => x.i);
          const sorted2 = [...score2].sort((a, b) => b.s - a.s).map((x) => x.i);
          expect(sorted2).toEqual(sorted1);
        },
      ),
    );
  });

  it("orthogonal vectors → score 0", () => {
    expect(cosineSimilarity([1, 0, 0, 0], [0, 1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 5])).toBe(0);
  });

  it("dimension mismatch throws", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow();
  });

  it("zero vector → score 0 (no NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});
