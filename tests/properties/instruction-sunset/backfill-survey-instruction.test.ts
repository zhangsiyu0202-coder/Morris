import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildSurveyInstructionBackfillUpdate } from "../../../scripts/backfill-survey-instruction";

describe("P-INSTRUCTION-SUNSET-01: advisory backfill never overwrites populated instruction", () => {
  it("for any nonblank instruction and arbitrary legacy data, the decision is skip-populated", () => {
    const nonBlank = fc.string({ minLength: 1 }).filter((value) => value.trim().length > 0);

    fc.assert(
      fc.property(nonBlank, fc.string(), fc.jsonValue(), (instruction, moderatorInstruction, flowConfig) => {
        const result = buildSurveyInstructionBackfillUpdate({
          $id: "survey-property",
          instruction,
          moderatorInstruction,
          flowConfig: JSON.stringify(flowConfig),
        });

        expect(result).toEqual({ kind: "skip-populated", surveyId: "survey-property" });
      }),
    );
  });
});
