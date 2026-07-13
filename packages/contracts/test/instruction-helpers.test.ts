import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  composeInstructionFromLegacy,
  resolveResearchIntent,
} from "@merism/contracts";

describe("contracts: composeInstructionFromLegacy (ADR-0015)", () => {
  it("returns null when every legacy field is empty", () => {
    expect(
      composeInstructionFromLegacy({
        researchGoal: "",
        targetAudience: "",
        introScript: "",
        moderatorInstruction: "",
      }),
    ).toBeNull();
  });

  it("returns null for an empty object and for all-whitespace fields", () => {
    expect(composeInstructionFromLegacy({})).toBeNull();
    expect(
      composeInstructionFromLegacy({
        researchGoal: "   ",
        targetAudience: "\n\t",
      }),
    ).toBeNull();
  });

  it("emits sections in ADR-0015 order (intent → audience → behavior → intro)", () => {
    const out = composeInstructionFromLegacy({
      researchGoal: "G",
      targetAudience: "A",
      moderatorInstruction: "M",
      introScript: "I",
    })!;
    const iIntent = out.indexOf("## 研究意图");
    const iAudience = out.indexOf("## 访谈对象");
    const iBehavior = out.indexOf("## 主持行为要点");
    const iIntro = out.indexOf("## 开场");
    expect(iIntent).toBeGreaterThanOrEqual(0);
    expect(iIntent).toBeLessThan(iAudience);
    expect(iAudience).toBeLessThan(iBehavior);
    expect(iBehavior).toBeLessThan(iIntro);
  });

  it("omits sections with no source content (partial migration)", () => {
    const out = composeInstructionFromLegacy({ researchGoal: "only goal" })!;
    expect(out).toContain("## 研究意图");
    expect(out).toContain("only goal");
    expect(out).not.toContain("## 访谈对象");
    expect(out).not.toContain("## 主持行为要点");
    expect(out).not.toContain("## 开场");
  });

  it("never fabricates a 结束 section", () => {
    const out = composeInstructionFromLegacy({
      researchGoal: "G",
      targetAudience: "A",
      introScript: "I",
      moderatorInstruction: "M",
    })!;
    expect(out).not.toContain("## 结束");
  });

  it("trims surrounding whitespace of each field", () => {
    const out = composeInstructionFromLegacy({ researchGoal: "  spaced goal  " })!;
    expect(out).toContain("spaced goal");
    expect(out).not.toContain("  spaced goal  ");
  });
});

describe("contracts: resolveResearchIntent (ADR-0015)", () => {
  it("prefers instruction verbatim when non-empty (no compositional wrapping)", () => {
    const md = "## 研究意图\n了解流失原因\n";
    const out = resolveResearchIntent({
      instruction: md,
      researchGoal: "IGNORED legacy goal",
      targetAudience: "IGNORED legacy audience",
    });
    expect(out).toBe(md.trim());
    expect(out).not.toContain("IGNORED");
  });

  it("trims instruction before returning", () => {
    expect(resolveResearchIntent({ instruction: "  hello manual  " })).toBe("hello manual");
  });

  it("falls back to legacy compose when instruction is empty", () => {
    const out = resolveResearchIntent({
      instruction: "",
      researchGoal: "G",
      targetAudience: "A",
    });
    expect(out).toContain("## 研究意图");
    expect(out).toContain("G");
    expect(out).toContain("## 访谈对象");
    expect(out).toContain("A");
  });

  it("treats whitespace-only instruction as empty and falls back", () => {
    const out = resolveResearchIntent({
      instruction: "   \n  ",
      researchGoal: "G",
    });
    expect(out).toContain("## 研究意图");
    expect(out).toContain("G");
  });

  it("returns empty string when nothing is available", () => {
    expect(resolveResearchIntent({})).toBe("");
    expect(
      resolveResearchIntent({
        instruction: "",
        researchGoal: "",
        targetAudience: "",
        introScript: "",
        moderatorInstruction: "",
      }),
    ).toBe("");
  });

  it("property: a non-blank instruction always wins over any legacy fields", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.string(),
        fc.string(),
        (instruction, researchGoal, targetAudience) => {
          const out = resolveResearchIntent({ instruction, researchGoal, targetAudience });
          expect(out).toBe(instruction.trim());
        },
      ),
    );
  });

  it("property: result is always the trimmed instruction or a string with no leading/trailing blank", () => {
    fc.assert(
      fc.property(
        fc.record({
          instruction: fc.string(),
          researchGoal: fc.string(),
          targetAudience: fc.string(),
          introScript: fc.string(),
          moderatorInstruction: fc.string(),
        }),
        (sources) => {
          const out = resolveResearchIntent(sources);
          expect(out).toBe(out.trim());
        },
      ),
    );
  });
});
