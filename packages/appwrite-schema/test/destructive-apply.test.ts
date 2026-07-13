import { describe, expect, it } from "vitest";

import {
  destructiveAttributesForApply,
  parseSchemaApplyOptions,
} from "../src/apply-schema.js";

describe("W5b destructive schema apply gate", () => {
  it("defaults to non-destructive and accepts only the exact destructive flag", () => {
    expect(parseSchemaApplyOptions([])).toEqual({ allowDestructive: false });
    expect(parseSchemaApplyOptions(["--allow-destructive"])).toEqual({
      allowDestructive: true,
    });
    expect(() => parseSchemaApplyOptions(["--force"])).toThrow(/Usage/);
  });

  it("allows deletion of only surveys.moderatorInstruction", () => {
    expect(
      destructiveAttributesForApply({
        surveys: new Set(["moderatorInstruction", "instruction"]),
      }),
    ).toEqual([{ collectionId: "surveys", key: "moderatorInstruction" }]);
  });
});
