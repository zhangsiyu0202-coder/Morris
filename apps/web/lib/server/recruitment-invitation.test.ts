import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildRecruitmentInvitation,
  parseRecruitmentRecipients,
  recruitmentInvitationCampaignKey,
} from "./recruitment-invitation";

describe("recruitment invitation renderer", () => {
  const criteria = {
    minAge: 25,
    maxAge: 40,
    genderRequirement: "女性优先，欢迎所有性别报名",
    targetParticipantCount: 18,
    participantAllocationNotes: "一线城市与非一线城市各至少 6 人",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };

  it("renders every recruitment requirement and the anonymous interview link", () => {
    const invitation = buildRecruitmentInvitation({
      studyTitle: "<移动银行体验调研>",
      criteria,
      interviewUrl: "https://app.example/interview?link=token_1",
    });

    expect(invitation.subject).toBe("邀请参与：<移动银行体验调研>");
    expect(invitation.text).toContain("年龄：25–40 岁");
    expect(invitation.text).toContain("性别：女性优先，欢迎所有性别报名");
    expect(invitation.text).toContain("招募人数：18 人");
    expect(invitation.text).toContain("人数分层说明：一线城市与非一线城市各至少 6 人");
    expect(invitation.text).toContain("https://app.example/interview?link=token_1");
    expect(invitation.html).toContain("&lt;移动银行体验调研&gt;");
    expect(invitation.html).toContain("25–40 岁");
  });

  it("normalizes recipients, deduplicates case-insensitively, and rejects malformed input", () => {
    expect(parseRecruitmentRecipients("A@example.com,\nb@example.com\na@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(() => parseRecruitmentRecipients("not-an-email")).toThrow("invalid_recipient_email");
  });

  it("keeps recipient addresses out of deterministic campaign keys", () => {
    const campaignKey = recruitmentInvitationCampaignKey({
      surveyId: "survey_1",
      linkId: "link_1",
      criteriaUpdatedAt: criteria.updatedAt,
      recipientEmail: "person@example.com",
    });
    expect(campaignKey).toContain("survey_1");
    expect(campaignKey).toContain("link_1");
    expect(campaignKey).not.toContain("person@example.com");
  });

  it("preserves every distinct valid recipient across comma and line-break layouts", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 })
          .map((ids) => ids.map((id) => `person${id}@example.com`)),
        fc.array(fc.constantFrom(",", "\n", "\r\n"), { minLength: 0, maxLength: 20 }),
        (emails, separators) => {
          const raw = emails
            .map((email, index) => `${index ? (separators[index - 1] ?? ",") : ""}${email}`)
            .join("");
          expect(parseRecruitmentRecipients(raw)).toEqual(emails.map((email) => email.toLowerCase()));
        },
      ),
    );
  });
});
