import { describe, expect, it } from "vitest";
import {
  MAX_KEY_MOMENTS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  validateAndClampConsolidatedSummary,
} from "../src/gemini/consolidate";
import type { ConsolidatedSummary, SegmentLlmOutput } from "../src/gemini/types";
import { VISUAL_SEGMENT_ANALYSIS_SYSTEM } from "../src/prompts/visual-segment-analysis";
import { VISUAL_CONSOLIDATION_SYSTEM } from "../src/prompts/visual-consolidation";

function seg(issueLevel: SegmentLlmOutput["issueLevel"], id = "s1"): SegmentLlmOutput {
  return {
    segmentId: id,
    startMs: 0,
    endMs: 1_000,
    title: "t",
    description: "d",
    observations: [],
    issueLevel,
    candidateMoments: [],
  };
}

function summary(overrides: Partial<ConsolidatedSummary> = {}): ConsolidatedSummary {
  return {
    summary: "s",
    sentiment: "positive",
    tags: [],
    keyMoments: [],
    ...overrides,
  };
}

describe("validateAndClampConsolidatedSummary — sentiment consistency (Gap 4b)", () => {
  it("downgrades positive to mixed when a segment has a major issue", () => {
    const out = validateAndClampConsolidatedSummary(summary({ sentiment: "positive" }), [
      seg("none", "a"),
      seg("major", "b"),
    ]);
    expect(out.sentiment).toBe("mixed");
  });

  it("keeps positive when only a minor issue is present", () => {
    const out = validateAndClampConsolidatedSummary(summary({ sentiment: "positive" }), [
      seg("minor", "a"),
    ]);
    expect(out.sentiment).toBe("positive");
  });

  it("keeps positive when no issues are present", () => {
    const out = validateAndClampConsolidatedSummary(summary({ sentiment: "positive" }), [
      seg("none", "a"),
    ]);
    expect(out.sentiment).toBe("positive");
  });

  it("does not touch a non-positive sentiment even with a major issue", () => {
    const out = validateAndClampConsolidatedSummary(summary({ sentiment: "negative" }), [
      seg("major", "a"),
    ]);
    expect(out.sentiment).toBe("negative");
  });
});

describe("validateAndClampConsolidatedSummary — keyMoments (Gap 4b)", () => {
  it("drops empty label/description, sorts by time, and caps at MAX_KEY_MOMENTS", () => {
    const moments = Array.from({ length: MAX_KEY_MOMENTS + 5 }, (_, i) => ({
      id: `m${i}`,
      timestampMs: (MAX_KEY_MOMENTS + 5 - i) * 1_000, // descending input
      label: `l${i}`,
      description: `d${i}`,
    }));
    moments.push({ id: "blank", timestampMs: 0, label: "  ", description: "x" });

    const out = validateAndClampConsolidatedSummary(summary({ keyMoments: moments }), [seg("none")]);

    expect(out.keyMoments).toHaveLength(MAX_KEY_MOMENTS);
    expect(out.keyMoments.every((m) => m.label.trim() && m.description.trim())).toBe(true);
    // sorted ascending
    const times = out.keyMoments.map((m) => m.timestampMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("validateAndClampConsolidatedSummary — tags (Gap 4b)", () => {
  it("trims, drops empty, de-duplicates, length-bounds, and caps count", () => {
    const longTag = "x".repeat(MAX_TAG_LENGTH + 20);
    const tags = [
      "  engaged  ",
      "engaged", // duplicate after trim
      "",
      "   ",
      longTag,
      ...Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`),
    ];
    const out = validateAndClampConsolidatedSummary(summary({ tags }), [seg("none")]);

    expect(out.tags.length).toBeLessThanOrEqual(MAX_TAGS);
    expect(out.tags).toContain("engaged");
    expect(out.tags.filter((t) => t === "engaged")).toHaveLength(1);
    expect(out.tags.every((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH)).toBe(true);
  });
});

describe("visual prompts carry injection defense (Gap 4a)", () => {
  it("segment system prompt marks transcript as untrusted and forbids executing embedded instructions", () => {
    expect(VISUAL_SEGMENT_ANALYSIS_SYSTEM).toContain("不可信");
    expect(VISUAL_SEGMENT_ANALYSIS_SYSTEM).toContain("忽略");
  });

  it("consolidation system prompt marks observations/transcript as untrusted", () => {
    expect(VISUAL_CONSOLIDATION_SYSTEM).toContain("不可信");
  });
});

describe("validateAndClampConsolidatedSummary — frustration model (Gap D)", () => {
  it("floors frustrationScore by the stated outcome (OUTCOME_SCORE_FLOORS)", () => {
    const out = validateAndClampConsolidatedSummary(
      summary({ frustrationScore: 0, outcome: "blocked" }),
      [seg("none")],
    );
    expect(out.frustrationScore).toBeGreaterThanOrEqual(0.75);
    expect(out.outcome).toBe("blocked");
  });

  it("floors frustrationScore by observed segment issues (signal floor)", () => {
    // 2 major of 2 segments -> signalFloor = min((0 + 2*2)/2,1)*0.5 = 0.5
    const out = validateAndClampConsolidatedSummary(
      summary({ frustrationScore: 0, outcome: "successful" }),
      [seg("major", "a"), seg("major", "b")],
    );
    expect(out.frustrationScore).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps a high LLM score and clamps to <= 1", () => {
    const out = validateAndClampConsolidatedSummary(
      summary({ frustrationScore: 1, outcome: "successful" }),
      [seg("none")],
    );
    expect(out.frustrationScore).toBe(1);
  });

  it("drops sentiment signals referencing non-existent segments", () => {
    const out = validateAndClampConsolidatedSummary(
      summary({
        sentimentSignals: [
          { signalType: "hesitation", segmentIndex: 0, description: "ok", intensity: 0.3 },
          { signalType: "confusion", segmentIndex: 9, description: "bad ref", intensity: 0.4 },
        ],
      }),
      [seg("none")],
    );
    expect(out.sentimentSignals).toHaveLength(1);
    expect(out.sentimentSignals![0].segmentIndex).toBe(0);
  });
});

describe("validateAndClampConsolidatedSummary — tagging (Gap E)", () => {
  it("keeps only fixed tags in the taxonomy and caps at 5", () => {
    const out = validateAndClampConsolidatedSummary(
      summary({ tagsFixed: ["engaged", "confusion", "not_a_real_tag", "hesitation"] }),
      [seg("none")],
    );
    expect(out.tagsFixed).toEqual(["engaged", "confusion", "hesitation"]);
  });

  it("sanitizes freeform tags (lowercase_underscore only) and caps at 5", () => {
    const out = validateAndClampConsolidatedSummary(
      summary({ tagsFreeform: ["first_dashboard_setup", "Has Spaces", "UPPER", "ok_2"] }),
      [seg("none")],
    );
    expect(out.tagsFreeform).toEqual(["first_dashboard_setup", "ok_2"]);
  });

  it("coerces highlighted to a strict boolean", () => {
    expect(validateAndClampConsolidatedSummary(summary({ highlighted: true }), [seg("none")]).highlighted).toBe(true);
    expect(validateAndClampConsolidatedSummary(summary({}), [seg("none")]).highlighted).toBe(false);
  });
});
