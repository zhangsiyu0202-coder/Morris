import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocument = vi.fn();
const updateDocument = vi.fn();
const sendEmail = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/owner", () => ({ requireOwnerUserId: vi.fn().mockResolvedValue("researcher_1") }));
vi.mock("@/lib/queries/client", () => ({
  DATABASE_ID: "merism",
  getServerClient: () => ({ databases: { getDocument, updateDocument } }),
}));
vi.mock("@/lib/server/email", () => ({
  EmailTransportError: class EmailTransportError extends Error {},
  sendEmail,
}));

const baseSurvey = {
  $id: "survey_1",
  ownerUserId: "researcher_1",
  authorId: "researcher_1",
  projectId: "project_1",
  title: "移动银行体验调研",
  status: "draft",
  flowConfig: "{}",
  instruction: "",
  version: 1,
  updatedAt: "2026-07-16T00:00:00.000Z",
  recruitmentMinAge: 25,
  recruitmentMaxAge: 40,
  recruitmentGenderRequirement: "女性优先",
  recruitmentTargetParticipantCount: 18,
  recruitmentAllocationNotes: "一线城市与非一线城市各至少 6 人",
  recruitmentCriteriaUpdatedAt: "2026-07-16T00:00:00.000Z",
};

const baseLink = {
  $id: "link_1",
  surveyId: "survey_1",
  token: "public_token",
  mode: "reusable",
  kind: "production",
  maxUses: 20,
  usedCount: 0,
  expiresAt: "2030-07-16T00:00:00.000Z",
  isRevoked: false,
};

describe("recruitment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://app.example";
    updateDocument.mockResolvedValue({});
  });

  it("persists criteria as Survey primitive attributes and refreshes the recruitment route", async () => {
    getDocument.mockResolvedValue(baseSurvey);
    const { saveRecruitmentCriteria } = await import("./recruitment");

    await expect(saveRecruitmentCriteria({
      surveyId: "survey_1",
      criteria: {
        minAge: 30,
        maxAge: 45,
        genderRequirement: "不限",
        targetParticipantCount: 12,
        participantAllocationNotes: "新老用户各半",
      },
    })).resolves.toMatchObject({ ok: true });

    expect(updateDocument).toHaveBeenCalledWith(
      "merism",
      "surveys",
      "survey_1",
      expect.objectContaining({
        recruitmentMinAge: 30,
        recruitmentMaxAge: 45,
        recruitmentTargetParticipantCount: 12,
        recruitmentAllocationNotes: "新老用户各半",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/studies/survey_1/recruit");
  });

  it("sends one individualized invitation per recipient through an active production link", async () => {
    getDocument.mockResolvedValueOnce(baseSurvey).mockResolvedValueOnce(baseLink);
    sendEmail.mockResolvedValue({ status: "sent", messageId: "resend_1", accepted: ["a@example.com"], rejected: [] });
    const { sendRecruitmentInvitations } = await import("./recruitment");

    await expect(
      sendRecruitmentInvitations({
        surveyId: "survey_1",
        linkId: "link_1",
        recipients: "a@example.com\nb@example.com",
      }),
    ).resolves.toEqual({
      ok: true,
      data: { total: 2, sent: 2, duplicate: 0, unavailable: false },
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: [{ email: "b@example.com" }],
        templateName: "recruitment_invitation",
        html: expect.stringContaining("25–40 岁"),
        campaignKey: expect.not.stringContaining("b@example.com"),
      }),
    );
  });

  it("returns a structured error for a test link before any email can be sent", async () => {
    getDocument.mockResolvedValueOnce(baseSurvey).mockResolvedValueOnce({ ...baseLink, kind: "test" });
    const { sendRecruitmentInvitations } = await import("./recruitment");

    await expect(sendRecruitmentInvitations({
      surveyId: "survey_1",
      linkId: "link_1",
      recipients: "a@example.com",
    })).resolves.toMatchObject({ ok: false, error: "recruitment_requires_production_link" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports malformed action input without reading a survey or sending email", async () => {
    const { sendRecruitmentInvitations } = await import("./recruitment");

    await expect(sendRecruitmentInvitations({
      surveyId: "survey_1",
      linkId: "",
      recipients: "person@example.com",
    })).resolves.toMatchObject({ ok: false, error: "invalid_input" });
    expect(getDocument).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
