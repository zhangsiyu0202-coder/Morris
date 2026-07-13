/**
 * Unit tests for `composeInstructionFromLegacy` — the pure, LLM-free
 * migration helper that turns the four ADR-0015 legacy fields
 * (`moderatorInstruction` / `flowConfig.researchGoal` /
 * `flowConfig.targetAudience` / `flowConfig.introScript`) into a
 * markdown skeleton. Backing the "从旧字段合成" button in the 研究说明 tab.
 */

import { describe, it, expect } from "vitest";
import { composeInstructionFromLegacy } from "../legacy-migration";

describe("composeInstructionFromLegacy", () => {
  it("returns null when all four fields are empty", () => {
    expect(
      composeInstructionFromLegacy({
        researchGoal: "",
        targetAudience: "",
        introScript: "",
        moderatorInstruction: "",
      }),
    ).toBeNull();
  });

  it("returns null when every field is only whitespace", () => {
    expect(
      composeInstructionFromLegacy({
        researchGoal: "  ",
        targetAudience: "\t",
        introScript: "\n",
        moderatorInstruction: "  \n",
      }),
    ).toBeNull();
  });

  it("returns null when the shape is {} (partial-migration row)", () => {
    expect(composeInstructionFromLegacy({})).toBeNull();
  });

  it("emits only the sections that have content (goal only)", () => {
    const result = composeInstructionFromLegacy({
      researchGoal: "了解设计师在跨部门评审时的沟通痛点",
    });
    expect(result).not.toBeNull();
    expect(result).toContain("## 研究意图");
    expect(result).toContain("了解设计师在跨部门评审时的沟通痛点");
    expect(result).not.toContain("## 访谈对象");
    expect(result).not.toContain("## 开场");
    expect(result).not.toContain("## 主持行为要点");
  });

  it("emits all four sections in the ADR-0015 order when all four fields are populated", () => {
    const result = composeInstructionFromLegacy({
      researchGoal: "了解产品定价决策路径",
      targetAudience: "SaaS 采购决策者",
      introScript: "先自我介绍并说明访谈时长与用途",
      moderatorInstruction: "语气温和,避免推销",
    });
    expect(result).not.toBeNull();
    const indexIntent = result!.indexOf("## 研究意图");
    const indexAudience = result!.indexOf("## 访谈对象");
    const indexBehavior = result!.indexOf("## 主持行为要点");
    const indexIntro = result!.indexOf("## 开场");
    // section order matches the ADR-0015 template
    expect(indexIntent).toBeGreaterThanOrEqual(0);
    expect(indexAudience).toBeGreaterThan(indexIntent);
    expect(indexBehavior).toBeGreaterThan(indexAudience);
    expect(indexIntro).toBeGreaterThan(indexBehavior);
  });

  it("does not fabricate a 结束 section (legacy shape has no source for it)", () => {
    const result = composeInstructionFromLegacy({
      researchGoal: "x",
      targetAudience: "y",
      introScript: "z",
      moderatorInstruction: "w",
    });
    expect(result).not.toContain("## 结束");
  });

  it("trims whitespace from each field's content", () => {
    const result = composeInstructionFromLegacy({
      researchGoal: "  goal with padding  \n",
    });
    expect(result).toContain("goal with padding");
    // The composed body has exactly one newline between heading and body,
    // and no extra padding around either.
    expect(result).toBe("## 研究意图\ngoal with padding");
  });

  it("preserves internal line breaks within a field (multi-line legacy text)", () => {
    const multiline = "line1\nline2\nline3";
    const result = composeInstructionFromLegacy({
      moderatorInstruction: multiline,
    });
    expect(result).toContain(multiline);
  });

  it("ignores empty strings while keeping populated fields (partial migration)", () => {
    const result = composeInstructionFromLegacy({
      researchGoal: "only this survives",
      targetAudience: "",
      introScript: "",
      moderatorInstruction: "",
    });
    expect(result).toBe("## 研究意图\nonly this survives");
  });
});
