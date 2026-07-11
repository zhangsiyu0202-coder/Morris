import { describe, it, expect } from "vitest";
import {
  VisualAnalysisOutputSchema,
  VISUAL_TAG_TAXONOMY,
  VISUAL_ANALYSIS_OUTCOMES,
} from "@merism/contracts";

const base = {
  source: "recording" as const,
  recordingFileId: "f1",
  durationMs: 1000,
  visualConfirmation: true,
  segments: [],
  keyMoments: [],
  summary: "s",
};

describe("contracts: VisualAnalysisOutput frustration + tagging (ADR 0005 Gap D/E)", () => {
  it("defaults the new fields for a minimal payload", () => {
    const out = VisualAnalysisOutputSchema.parse(base);
    expect(out.frustrationScore).toBe(0);
    expect(out.outcome).toBe("successful");
    expect(out.sentimentSignals).toEqual([]);
    expect(out.tagsFixed).toEqual([]);
    expect(out.tagsFreeform).toEqual([]);
    expect(out.highlighted).toBe(false);
  });

  it("accepts a full frustration + tagging payload", () => {
    const out = VisualAnalysisOutputSchema.parse({
      ...base,
      frustrationScore: 0.6,
      outcome: "frustrated",
      sentimentSignals: [
        { signalType: "confusion", segmentIndex: 0, description: "asked to repeat", intensity: 0.5 },
      ],
      tagsFixed: ["engaged", "confusion"],
      tagsFreeform: ["first_dashboard_setup"],
      highlighted: true,
    });
    expect(out.frustrationScore).toBe(0.6);
    expect(out.outcome).toBe("frustrated");
    expect(out.tagsFixed).toContain("engaged");
    expect(out.highlighted).toBe(true);
  });

  it("rejects out-of-range frustrationScore and bad outcome / signal intensity", () => {
    expect(VisualAnalysisOutputSchema.safeParse({ ...base, frustrationScore: 1.5 }).success).toBe(false);
    expect(VisualAnalysisOutputSchema.safeParse({ ...base, outcome: "bogus" }).success).toBe(false);
    expect(
      VisualAnalysisOutputSchema.safeParse({
        ...base,
        sentimentSignals: [{ signalType: "other", segmentIndex: 0, description: "x", intensity: 2 }],
      }).success,
    ).toBe(false);
  });

  it("taxonomy keys and outcomes are non-empty and stable", () => {
    expect(Object.keys(VISUAL_TAG_TAXONOMY).length).toBeGreaterThanOrEqual(5);
    expect(VISUAL_ANALYSIS_OUTCOMES).toEqual(["successful", "friction", "frustrated", "blocked"]);
  });
});
