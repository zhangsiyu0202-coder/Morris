import { describe, it, expect } from "vitest";

import {
  buildValidRefs,
  checkHallucinationRatio,
  refKey,
} from "../src/hallucination.js";

describe("buildValidRefs", () => {
  it("yields N keys for N segments", () => {
    const set = buildValidRefs("t1", 3);
    expect(set).toEqual(new Set(["t1#0", "t1#1", "t1#2"]));
  });

  it("returns empty set for 0 segments", () => {
    expect(buildValidRefs("t1", 0).size).toBe(0);
  });
});

describe("refKey", () => {
  it("normalizes to transcriptId#segmentIndex", () => {
    expect(refKey({ transcriptId: "t1", segmentIndex: 7 })).toBe("t1#7");
  });
});

describe("checkHallucinationRatio", () => {
  const valid = buildValidRefs("t1", 5); // 0..4

  it("vacuously OK on no refs at all", () => {
    const r = checkHallucinationRatio({
      themes: [],
      citations: [],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r).toEqual({ ratio: 0, ok: true, totalRefs: 0, badRefs: [] });
  });

  it("OK when ratio is 0", () => {
    const r = checkHallucinationRatio({
      themes: [{ evidence: [{ transcriptId: "t1", segmentIndex: 0 }] }],
      citations: [{ segmentRef: { transcriptId: "t1", segmentIndex: 1 } }],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.ratio).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.badRefs).toEqual([]);
    expect(r.totalRefs).toBe(2);
  });

  it("OK at exactly threshold", () => {
    // 1 bad / 7 total ≈ 0.142, threshold 0.15 → OK
    const r = checkHallucinationRatio({
      themes: [
        {
          evidence: [
            { transcriptId: "t1", segmentIndex: 0 },
            { transcriptId: "t1", segmentIndex: 1 },
            { transcriptId: "t1", segmentIndex: 99 }, // bad
          ],
        },
      ],
      citations: [
        { segmentRef: { transcriptId: "t1", segmentIndex: 2 } },
        { segmentRef: { transcriptId: "t1", segmentIndex: 3 } },
        { segmentRef: { transcriptId: "t1", segmentIndex: 4 } },
        { segmentRef: { transcriptId: "t1", segmentIndex: 0 } },
      ],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.totalRefs).toBe(7);
    expect(r.badRefs).toHaveLength(1);
    expect(r.ratio).toBeCloseTo(1 / 7, 5);
    expect(r.ok).toBe(true);
  });

  it("NOT ok above threshold", () => {
    // 2 bad / 4 total = 0.5 → not ok
    const r = checkHallucinationRatio({
      themes: [
        {
          evidence: [
            { transcriptId: "t1", segmentIndex: 0 },
            { transcriptId: "t1", segmentIndex: 99 },
          ],
        },
      ],
      citations: [
        { segmentRef: { transcriptId: "t1", segmentIndex: 2 } },
        { segmentRef: { transcriptId: "t2", segmentIndex: 0 } }, // bad: wrong transcriptId
      ],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.ratio).toBe(0.5);
    expect(r.ok).toBe(false);
    expect(r.badRefs).toHaveLength(2);
  });

  it("counts theme evidence + citations together", () => {
    const r = checkHallucinationRatio({
      themes: [{ evidence: [] }],
      citations: [{ segmentRef: { transcriptId: "t1", segmentIndex: 99 } }],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.totalRefs).toBe(1);
    expect(r.ratio).toBe(1.0);
    expect(r.ok).toBe(false);
  });
});
