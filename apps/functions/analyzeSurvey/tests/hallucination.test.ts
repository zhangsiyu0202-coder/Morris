import { describe, it, expect } from "vitest";

import {
  buildValidRefsFromSessionReports,
  checkHallucinationRatio,
  refKey,
} from "../src/hallucination.js";

describe("buildValidRefsFromSessionReports", () => {
  it("unions citations + theme evidence across reports", () => {
    const set = buildValidRefsFromSessionReports([
      {
        citations: [{ segmentRef: { transcriptId: "tA", segmentIndex: 0 } }],
        themes: [{ evidence: [{ transcriptId: "tA", segmentIndex: 1 }] }],
      },
      {
        citations: [{ segmentRef: { transcriptId: "tB", segmentIndex: 0 } }],
        themes: [
          { evidence: [{ transcriptId: "tB", segmentIndex: 1 }, { transcriptId: "tB", segmentIndex: 2 }] },
        ],
      },
    ]);
    expect(set).toEqual(new Set(["tA#0", "tA#1", "tB#0", "tB#1", "tB#2"]));
  });

  it("handles empty input", () => {
    expect(buildValidRefsFromSessionReports([]).size).toBe(0);
  });
});

describe("checkHallucinationRatio (survey)", () => {
  const valid = new Set(["tA#0", "tA#1", "tB#0"]);

  it("vacuously OK on no refs", () => {
    expect(
      checkHallucinationRatio({
        themes: [],
        citations: [],
        validRefs: valid,
        threshold: 0.15,
      }),
    ).toEqual({ ratio: 0, ok: true, totalRefs: 0, badRefs: [] });
  });

  it("OK when all refs in union", () => {
    const r = checkHallucinationRatio({
      themes: [{ evidence: [{ transcriptId: "tA", segmentIndex: 0 }] }],
      citations: [{ segmentRef: { transcriptId: "tB", segmentIndex: 0 } }],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBe(0);
  });

  it("rejects when ratio above threshold", () => {
    // 2 bad / 3 total = 0.67
    const r = checkHallucinationRatio({
      themes: [{ evidence: [{ transcriptId: "tA", segmentIndex: 99 }] }],
      citations: [
        { segmentRef: { transcriptId: "tA", segmentIndex: 88 } },
        { segmentRef: { transcriptId: "tA", segmentIndex: 0 } },
      ],
      validRefs: valid,
      threshold: 0.15,
    });
    expect(r.ok).toBe(false);
    expect(r.badRefs).toHaveLength(2);
    expect(r.ratio).toBeCloseTo(2 / 3, 5);
  });

  it("refKey normalizes consistently", () => {
    expect(refKey({ transcriptId: "tA", segmentIndex: 7 })).toBe("tA#7");
  });
});
