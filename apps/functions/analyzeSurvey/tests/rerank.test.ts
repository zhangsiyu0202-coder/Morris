import { describe, expect, it } from "vitest";

import {
  buildRerankCandidates,
  buildRecallBoundedRerankCandidates,
  validateRerankResults,
} from "../src/rerank.js";

describe("survey finding rerank policy", () => {
  it("makes only evidence-backed themes and linked insights eligible for reranking", () => {
    const candidates = buildRerankCandidates({
      themes: [
        { id: "theme-pricing", label: "Hidden fees", mentions: 2, pct: 100, sentiment: "negative" },
        { id: "theme-unused", label: "Unproven", mentions: 1, pct: 50, sentiment: "neutral" },
      ],
      themeContexts: [
        {
          id: "theme-pricing",
          label: "Hidden fees",
          description: "Fees appear late in checkout.",
          evidenceRefs: [{ transcriptId: "tx-1", segmentIndex: 2 }],
        },
        { id: "theme-unused", label: "Unproven", description: "No evidence", evidenceRefs: [] },
      ],
      insights: [
        {
          id: "insight-trust",
          title: "Late fees reduce trust",
          text: "Participants abandon checkout after surprise charges.",
          confidence: 0.9,
          supportingThemeIds: ["theme-pricing"],
        },
        {
          id: "insight-orphan",
          title: "Unsupported",
          text: "This cannot be traced.",
          confidence: 0.8,
          supportingThemeIds: [],
        },
      ],
    });

    expect(candidates.map((candidate) => candidate.finding)).toEqual([
      { kind: "theme", sourceId: "theme-pricing" },
      { kind: "insight", sourceId: "insight-trust" },
    ]);
    expect(candidates[0]?.document).toContain("evidenceCount: 1");
    expect(candidates[1]?.document).toContain("supportingThemeIds: theme-pricing");
  });

  it("maps valid provider indexes to a complete, deterministic report ordering", () => {
    const candidates = buildRerankCandidates({
      themes: [{ id: "theme-pricing", label: "Hidden fees", mentions: 2, pct: 100, sentiment: "negative" }],
      themeContexts: [
        { id: "theme-pricing", label: "Hidden fees", description: "Fees appear late in checkout.", evidenceRefs: [{ transcriptId: "tx-1", segmentIndex: 2 }] },
      ],
      insights: [{ id: "insight-trust", title: "Late fees reduce trust", text: "Participants abandon checkout after surprise charges.", confidence: 0.9, supportingThemeIds: ["theme-pricing"] }],
    });

    expect(validateRerankResults(candidates, [
      { index: 1, relevanceScore: 0.92 },
      { index: 0, relevanceScore: 0.72 },
    ])).toEqual([
      { kind: "insight", sourceId: "insight-trust", rank: 1, relevanceScore: 0.92 },
      { kind: "theme", sourceId: "theme-pricing", rank: 2, relevanceScore: 0.72 },
    ]);
  });

  it("does not let Cohere see themes absent from Jina recall", () => {
    const candidates = buildRecallBoundedRerankCandidates({
      themes: [
        { id: "theme-recalled", label: "Owner gap", mentions: 2, pct: 100, sentiment: "negative" },
        { id: "theme-not-recalled", label: "Price", mentions: 1, pct: 50, sentiment: "neutral" },
      ],
      themeContexts: [
        { id: "theme-recalled", label: "Owner gap", description: "No rollout owner.", evidenceRefs: [{ transcriptId: "tx-1", segmentIndex: 1 }] },
        { id: "theme-not-recalled", label: "Price", description: "Cost concern.", evidenceRefs: [{ transcriptId: "tx-2", segmentIndex: 2 }] },
      ],
      insights: [
        { id: "insight-owner", title: "Ownership", text: "Ownership blocks rollout.", confidence: 0.8, supportingThemeIds: ["theme-recalled"] },
        { id: "insight-price", title: "Price", text: "Price matters.", confidence: 0.8, supportingThemeIds: ["theme-not-recalled"] },
      ],
      recalledRefs: new Set(["tx-1:1"]),
    });
    expect(candidates.map((candidate) => candidate.finding)).toEqual([
      { kind: "theme", sourceId: "theme-recalled" },
      { kind: "insight", sourceId: "insight-owner" },
    ]);
  });

  it("rejects incomplete, out-of-range, or non-finite provider results", () => {
    const candidates = buildRerankCandidates({
      themes: [{ id: "theme-pricing", label: "Hidden fees", mentions: 1, pct: 100, sentiment: "negative" }],
      themeContexts: [
        { id: "theme-pricing", label: "Hidden fees", description: "Fees appear late.", evidenceRefs: [{ transcriptId: "tx-1", segmentIndex: 2 }] },
      ],
      insights: [],
    });

    expect(() => validateRerankResults(candidates, [])).toThrow(/complete/);
    expect(() => validateRerankResults(candidates, [{ index: 1, relevanceScore: 0.5 }])).toThrow(/index/);
    expect(() => validateRerankResults(candidates, [{ index: 0, relevanceScore: Number.NaN }])).toThrow(/score/);
  });
});
