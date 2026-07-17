import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildEvidenceSourceSegments } from "../../../apps/functions/analyzeEvidence/src/evidence.js";

describe("P-RE-03 research evidence retains an original respondent source", () => {
  it("every selected source references a non-empty respondent segment at its original index", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        speaker: fc.constantFrom("agent", "interviewer", "ai", "assistant", "interviewee", "respondent"),
        text: fc.string(),
      }), { maxLength: 80 }),
      (raw) => {
        const segments = raw.map((segment, index) => ({
          ...segment,
          startMs: index * 10,
          endMs: index * 10 + 1,
        }));
        const sources = buildEvidenceSourceSegments(segments);
        for (const source of sources) {
          const original = segments[source.segmentIndex]!;
          expect(["agent", "interviewer", "ai", "assistant"]).not.toContain(original.speaker);
          expect(source.sourceText).toBe(original.text.trim());
          expect(source.sourceText.length).toBeGreaterThan(0);
        }
      },
    ), { numRuns: 50 });
  });
});
