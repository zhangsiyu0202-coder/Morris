import { describe, expect, it } from "vitest";
import {
  buildEvidenceSourceSegments,
  validateClaimsForSources,
} from "../src/evidence.js";

describe("research evidence source selection", () => {
  it("keeps original respondent segment indexes and the preceding moderator context", () => {
    const sources = buildEvidenceSourceSegments([
      { speaker: "agent", startMs: 0, endMs: 1000, text: "What blocks adoption?" },
      { speaker: "interviewee", startMs: 1000, endMs: 2000, text: " Nobody owns the rollout. " },
      { speaker: "assistant", startMs: 2000, endMs: 3000, text: "Could you explain?" },
      { speaker: "respondent", startMs: 3000, endMs: 4000, text: "Budget is already approved." },
    ]);
    expect(sources).toEqual([
      { segmentIndex: 1, sourceText: "Nobody owns the rollout.", questionText: "What blocks adoption?" },
      { segmentIndex: 3, sourceText: "Budget is already approved.", questionText: "Could you explain?" },
    ]);
  });

  it("rejects an LLM claim pointing at moderator-only source text", () => {
    const sources = buildEvidenceSourceSegments([
      { speaker: "agent", startMs: 0, endMs: 1, text: "Why?" },
      { speaker: "interviewee", startMs: 1, endMs: 2, text: "No internal owner." },
    ]);
    expect(() => validateClaimsForSources({
      claims: [{
        segmentIndex: 0,
        claim: "There is no internal owner.",
        claimType: "barrier",
        stance: "negative",
      }],
    }, sources)).toThrow("non-respondent");
  });
});
