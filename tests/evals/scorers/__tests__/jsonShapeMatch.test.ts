import { describe, it, expect } from "vitest";
import { jsonShapeMatchScorer } from "../jsonShapeMatch";

describe("jsonShapeMatch scorer", () => {
  const goodSurveyDraft = {
    title: "用户访谈大纲",
    instruction: "研究目标：了解中小企业研究员的用户痛点；以简短、友好的开场开始访谈。",
    sections: [
      {
        title: "背景",
        objective: "了解受访者背景",
        questions: [
          { questionText: "请简单介绍您的工作经验", questionType: "open_ended" },
        ],
      },
    ],
  };

  describe("schema match", () => {
    it("passes when output matches the named schema", async () => {
      const r = await jsonShapeMatchScorer.score(null, goodSurveyDraft, {
        must_match_schema: "SurveyDraftSchema",
      });
      expect(r.ok).toBe(true);
    });

    it("fails with a pointed error when schema mismatches", async () => {
      const r = await jsonShapeMatchScorer.score(null, { title: 123 }, {
        must_match_schema: "SurveyDraftSchema",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("schema mismatch");
      }
    });

    it("fails when schema name is not in the registry", async () => {
      const r = await jsonShapeMatchScorer.score(null, {}, {
        must_match_schema: "NotARealSchema",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("unknown schema name");
      }
    });

    it("uses schema_path to navigate into wrapped output", async () => {
      const wrapped = { kind: "draft", draft: goodSurveyDraft };
      const r = await jsonShapeMatchScorer.score(null, wrapped, {
        must_match_schema: "SurveyDraftSchema",
        schema_path: "draft",
      });
      expect(r.ok).toBe(true);
    });

    it("fails clearly when schema_path does not resolve in output", async () => {
      const r = await jsonShapeMatchScorer.score(null, { kind: "refusal", reason: "no" }, {
        must_match_schema: "SurveyDraftSchema",
        schema_path: "draft",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("schema_path");
        expect(r.reason).toContain("did not resolve");
      }
    });
  });

  describe("keyword presence (must_contain_keywords)", () => {
    it("passes when all keywords present (case-insensitive)", async () => {
      const r = await jsonShapeMatchScorer.score(null, "Background, Pain points, Solution", {
        must_contain_keywords: ["background", "pain points", "Solution"],
      });
      expect(r.ok).toBe(true);
    });

    it("fails listing missing keywords", async () => {
      const r = await jsonShapeMatchScorer.score(null, "Only background here", {
        must_contain_keywords: ["background", "pain points", "Solution"],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("pain points");
        expect(r.reason).toContain("Solution");
        expect(r.reason).not.toContain("background");
      }
    });

    it("works on structured output via JSON.stringify", async () => {
      const r = await jsonShapeMatchScorer.score(null, { x: "background" }, {
        must_contain_keywords: ["background"],
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("keyword absence (must_not_mention_keywords)", () => {
    it("passes when no forbidden keyword present", async () => {
      const r = await jsonShapeMatchScorer.score(null, "Background", {
        must_not_mention_keywords: ["billing", "team"],
      });
      expect(r.ok).toBe(true);
    });

    it("fails listing the forbidden keywords found", async () => {
      const r = await jsonShapeMatchScorer.score(null, "Discuss billing options", {
        must_not_mention_keywords: ["billing", "team"],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("billing");
        expect(r.reason).not.toContain("team");
      }
    });
  });

  describe("combined rubric", () => {
    it("evaluates all three checks in order; first failure short-circuits", async () => {
      const r = await jsonShapeMatchScorer.score(null, { title: 123 }, {
        must_match_schema: "SurveyDraftSchema",
        must_contain_keywords: ["never-reached"],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("schema mismatch");
        expect(r.reason).not.toContain("never-reached");
      }
    });

    it("returns ok with zero tokens when all checks pass and rubric is empty", async () => {
      const r = await jsonShapeMatchScorer.score(null, "anything", {});
      expect(r.ok).toBe(true);
      expect(r.tokens).toEqual({ input: 0, output: 0 });
    });
  });
});
