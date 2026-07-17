import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RecruitmentCriteriaSchema,
  SaveRecruitmentCriteriaRequestSchema,
  SendRecruitmentInvitationsActionResponseSchema,
  SurveySchema,
} from "@merism/contracts";

describe("contracts: recruitment criteria", () => {
  it("accepts age, gender, target count, and participant allocation notes", () => {
    expect(
      RecruitmentCriteriaSchema.parse({
        minAge: 25,
        maxAge: 40,
        genderRequirement: "女性优先，欢迎所有性别报名",
        targetParticipantCount: 18,
        participantAllocationNotes: "一线城市与非一线城市各至少 6 人",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    ).toMatchObject({
      minAge: 25,
      maxAge: 40,
      targetParticipantCount: 18,
    });
  });

  it("rejects inverted age ranges and a non-positive participant target", () => {
    expect(
      RecruitmentCriteriaSchema.safeParse({
        minAge: 41,
        maxAge: 40,
        targetParticipantCount: 10,
      }).success,
    ).toBe(false);
    expect(RecruitmentCriteriaSchema.safeParse({ targetParticipantCount: 0 }).success).toBe(false);
  });

  it("preserves valid age ordering for every generated range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 100_000 }),
        (first, second, targetParticipantCount) => {
          const minAge = Math.min(first, second);
          const maxAge = Math.max(first, second);
          const parsed = RecruitmentCriteriaSchema.parse({
            minAge,
            maxAge,
            targetParticipantCount,
          });
          expect(parsed.minAge).toBeLessThanOrEqual(parsed.maxAge!);
        },
      ),
    );
  });

  it("exposes recruitment criteria through Survey", () => {
    const survey = SurveySchema.parse({
      $id: "survey_1",
      projectId: "project_1",
      title: "Mobile banking study",
      updatedAt: "2026-07-16T00:00:00.000Z",
      recruitmentCriteria: { targetParticipantCount: 12 },
    });
    expect(survey.recruitmentCriteria.targetParticipantCount).toBe(12);
  });

  it("requires a traceable, typed outcome at the recruitment action boundary", () => {
    expect(
      SaveRecruitmentCriteriaRequestSchema.safeParse({
        surveyId: "survey_1",
        criteria: { targetParticipantCount: 12 },
      }).success,
    ).toBe(true);
    expect(
      SendRecruitmentInvitationsActionResponseSchema.safeParse({
        ok: false,
        error: "invalid_input",
      }).success,
    ).toBe(false);
  });
});
