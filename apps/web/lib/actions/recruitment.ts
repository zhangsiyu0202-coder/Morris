"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  InterviewLinkSchema,
  RecruitmentCriteriaSchema,
  RecruitmentActionErrorCodeSchema,
  SaveRecruitmentCriteriaRequestSchema,
  SaveRecruitmentCriteriaResponseSchema,
  SendRecruitmentInvitationsRequestSchema,
  SendRecruitmentInvitationsActionResponseSchema,
  SendRecruitmentInvitationsResponseSchema,
  SurveySchema,
  type RecruitmentCriteria,
  type RecruitmentActionErrorCode,
  type SaveRecruitmentCriteriaResponse,
  type SendRecruitmentInvitationsActionResponse,
} from "@merism/contracts";
import { createLogger } from "@merism/observability";
import { requireOwnerUserId } from "@/lib/auth/owner";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";
import { EmailTransportError, sendEmail } from "@/lib/server/email";
import {
  buildRecruitmentInvitation,
  parseRecruitmentRecipients,
  recruitmentInvitationCampaignKey,
} from "@/lib/server/recruitment-invitation";

const SURVEYS = "surveys";
const LINKS = "interview_links";

type RawDocument = Record<string, unknown>;

async function assertSurveyAuthor(surveyId: string): Promise<{ survey: ReturnType<typeof SurveySchema.parse> }> {
  const ownerUserId = await requireOwnerUserId();
  const raw = (await getServerClient().databases.getDocument(
    DATABASE_ID,
    SURVEYS,
    surveyId,
  )) as unknown as RawDocument;
  const authorId = typeof raw.authorId === "string" ? raw.authorId : raw.ownerUserId;
  if (authorId !== ownerUserId) throw new Error("survey_not_owned");
  return { survey: SurveySchema.parse(raw) };
}

function recruitmentActionFailure(
  error: unknown,
  logger: ReturnType<typeof createLogger>,
): { ok: false; error: RecruitmentActionErrorCode; traceId: string } {
  if (error instanceof ZodError) {
    logger.warn("recruitment action rejected", { error: "invalid_input" });
    return { ok: false, error: "invalid_input", traceId: logger.traceId };
  }
  if (error instanceof EmailTransportError) {
    logger.error("recruitment email delivery failed", { errorName: error.name });
    return { ok: false, error: "email_delivery_failed", traceId: logger.traceId };
  }
  const errorCode = RecruitmentActionErrorCodeSchema.safeParse(
    error instanceof Error ? error.message : undefined,
  );
  if (errorCode.success) {
    logger.warn("recruitment action rejected", { error: errorCode.data });
    return { ok: false, error: errorCode.data, traceId: logger.traceId };
  }
  logger.error("recruitment action failed", {
    errorName: error instanceof Error ? error.name : "unknown_error",
  });
  return { ok: false, error: "internal_error", traceId: logger.traceId };
}

function criteriaDocumentFields(criteria: RecruitmentCriteria, updatedAt: string) {
  return {
    recruitmentMinAge: criteria.minAge ?? null,
    recruitmentMaxAge: criteria.maxAge ?? null,
    recruitmentGenderRequirement: criteria.genderRequirement,
    recruitmentTargetParticipantCount: criteria.targetParticipantCount ?? null,
    recruitmentAllocationNotes: criteria.participantAllocationNotes,
    recruitmentCriteriaUpdatedAt: updatedAt,
    updatedAt,
  };
}

function absoluteInterviewUrl(token: string): string {
  const base = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!base) throw new Error("app_url_not_configured");
  return `${base.replace(/\/$/, "")}/interview?link=${encodeURIComponent(token)}`;
}

function assertEligibleProductionLink(raw: RawDocument, surveyId: string) {
  const link = InterviewLinkSchema.parse(raw);
  if (link.surveyId !== surveyId) throw new Error("link_survey_mismatch");
  if (link.kind !== "production") throw new Error("recruitment_requires_production_link");
  if (link.isRevoked) throw new Error("link_revoked");
  if (new Date(link.expiresAt).getTime() <= Date.now()) throw new Error("link_expired");
  if (link.usedCount >= link.maxUses) throw new Error("link_exhausted");
  return link;
}

export async function getRecruitmentCriteria(surveyId: string): Promise<RecruitmentCriteria> {
  const { survey } = await assertSurveyAuthor(surveyId);
  return survey.recruitmentCriteria;
}

export async function saveRecruitmentCriteria(
  rawInput: unknown,
): Promise<SaveRecruitmentCriteriaResponse> {
  const logger = createLogger("action.recruitment");
  try {
    const input = SaveRecruitmentCriteriaRequestSchema.parse(rawInput);
    await assertSurveyAuthor(input.surveyId);
    const criteria = RecruitmentCriteriaSchema.parse(input.criteria);
    const updatedAt = new Date().toISOString();
    const saved = { ...criteria, updatedAt };
    await getServerClient().databases.updateDocument(
      DATABASE_ID,
      SURVEYS,
      input.surveyId,
      criteriaDocumentFields(saved, updatedAt),
    );
    revalidatePath(`/studies/${input.surveyId}/recruit`);
    logger.info("recruitment criteria saved", { surveyId: input.surveyId });
    return SaveRecruitmentCriteriaResponseSchema.parse({ ok: true, data: saved });
  } catch (error) {
    return SaveRecruitmentCriteriaResponseSchema.parse(recruitmentActionFailure(error, logger));
  }
}

export async function sendRecruitmentInvitations(
  rawInput: unknown,
): Promise<SendRecruitmentInvitationsActionResponse> {
  const logger = createLogger("action.recruitment");
  try {
    const input = SendRecruitmentInvitationsRequestSchema.parse(rawInput);
    const { survey } = await assertSurveyAuthor(input.surveyId);
    const criteria = survey.recruitmentCriteria;
    if (!criteria.updatedAt) throw new Error("recruitment_criteria_not_saved");
    if (!criteria.targetParticipantCount) throw new Error("recruitment_target_participant_count_required");

    const rawLink = (await getServerClient().databases.getDocument(
      DATABASE_ID,
      LINKS,
      input.linkId,
    )) as unknown as RawDocument;
    const link = assertEligibleProductionLink(rawLink, input.surveyId);
    const invitation = buildRecruitmentInvitation({
      studyTitle: survey.title,
      criteria,
      interviewUrl: absoluteInterviewUrl(link.token),
    });
    const recipients = parseRecruitmentRecipients(input.recipients);
    let sent = 0;
    let duplicate = 0;

    for (const recipientEmail of recipients) {
      const result = await sendEmail({
        to: [{ email: recipientEmail }],
        subject: invitation.subject,
        text: invitation.text,
        html: invitation.html,
        campaignKey: recruitmentInvitationCampaignKey({
          surveyId: input.surveyId,
          linkId: link.$id,
          criteriaUpdatedAt: criteria.updatedAt,
          recipientEmail,
        }),
        templateName: "recruitment_invitation",
        requireAbsoluteUrls: true,
      });
      if (result.status === "unavailable") {
        logger.warn("recruitment invitation unavailable", {
          surveyId: input.surveyId,
          recipientCount: recipients.length,
          reason: result.reason,
        });
        return SendRecruitmentInvitationsActionResponseSchema.parse({
          ok: true,
          data: {
            total: recipients.length,
            sent,
            duplicate,
            unavailable: true,
            unavailableReason: result.reason,
          },
        });
      }
      if (result.status === "sent") sent += 1;
      else duplicate += 1;
    }

    logger.info("recruitment invitations completed", {
      surveyId: input.surveyId,
      recipientCount: recipients.length,
      sent,
      duplicate,
    });
    return SendRecruitmentInvitationsActionResponseSchema.parse({
      ok: true,
      data: SendRecruitmentInvitationsResponseSchema.parse({
        total: recipients.length,
        sent,
        duplicate,
        unavailable: false,
      }),
    });
  } catch (error) {
    return SendRecruitmentInvitationsActionResponseSchema.parse(recruitmentActionFailure(error, logger));
  }
}
