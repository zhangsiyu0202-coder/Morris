// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecruitView } from "../recruit-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/links", () => ({
  createInterviewLink: vi.fn(),
  revokeInterviewLink: vi.fn(),
}));
vi.mock("@/lib/actions/recruitment", () => ({
  saveRecruitmentCriteria: vi.fn(),
  sendRecruitmentInvitations: vi.fn(),
}));

afterEach(cleanup);

describe("RecruitView recruitment invitations", () => {
  it("requires saving edited criteria before enabling invitation delivery", () => {
    render(
      <RecruitView
        surveyId="survey_1"
        initialLinks={[{
          $id: "link_1",
          surveyId: "survey_1",
          token: "public_token",
          mode: "reusable",
          kind: "production",
          maxUses: 20,
          usedCount: 0,
          expiresAt: "2030-07-16T00:00:00.000Z",
          isRevoked: false,
        }]}
        testLink={null}
        initialCriteria={{
          targetParticipantCount: 10,
          genderRequirement: "",
          participantAllocationNotes: "",
          updatedAt: "2026-07-16T00:00:00.000Z",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /邮件邀请/ }));
    fireEvent.change(screen.getByLabelText("正式访谈链接"), { target: { value: "link_1" } });
    fireEvent.change(screen.getByLabelText("收件人邮箱"), { target: { value: "person@example.com" } });

    const sendButton = screen.getByRole("button", { name: "发送邮件邀请" });
    expect(sendButton).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText(/招募人数/), { target: { value: "11" } });

    expect(sendButton).toHaveProperty("disabled", true);
    expect(screen.getByText("招募条件已修改，请先保存后再发送。")).toBeTruthy();
  });
});
