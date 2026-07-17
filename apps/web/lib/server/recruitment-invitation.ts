import { createHash } from "node:crypto";
import { z } from "zod";
import type { RecruitmentCriteria } from "@merism/contracts";

const RecipientEmailSchema = z.string().trim().toLowerCase().email();
const MAX_RECIPIENTS_PER_SEND = 50;

export interface RecruitmentInvitation {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function criteriaLines(criteria: RecruitmentCriteria): string[] {
  if (!criteria.targetParticipantCount) {
    throw new Error("recruitment_target_participant_count_required");
  }
  const lines: string[] = [];
  if (criteria.minAge !== undefined && criteria.maxAge !== undefined) {
    lines.push(`年龄：${criteria.minAge}–${criteria.maxAge} 岁`);
  } else if (criteria.minAge !== undefined) {
    lines.push(`年龄：${criteria.minAge} 岁及以上`);
  } else if (criteria.maxAge !== undefined) {
    lines.push(`年龄：${criteria.maxAge} 岁及以下`);
  }
  if (criteria.genderRequirement) lines.push(`性别：${criteria.genderRequirement}`);
  lines.push(`招募人数：${criteria.targetParticipantCount} 人`);
  if (criteria.participantAllocationNotes) {
    lines.push(`人数分层说明：${criteria.participantAllocationNotes}`);
  }
  return lines;
}

function assertSafeInterviewUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid_interview_url");
  }
  return url;
}

export function buildRecruitmentInvitation(args: {
  studyTitle: string;
  criteria: RecruitmentCriteria;
  interviewUrl: string;
}): RecruitmentInvitation {
  const interviewUrl = assertSafeInterviewUrl(args.interviewUrl).toString();
  const requirements = criteriaLines(args.criteria);
  const text = [
    "你好，",
    "",
    `我们正在招募参与「${args.studyTitle}」访谈的受访者。`,
    "如果你符合以下条件，欢迎参与：",
    ...requirements.map((line) => `- ${line}`),
    "",
    "访谈入口：",
    interviewUrl,
    "",
    "感谢你的时间。",
  ].join("\n");

  return {
    subject: `邀请参与：${args.studyTitle}`,
    text,
    html: [
      "<!DOCTYPE html>",
      "<html><body style=\"font-family: Arial, sans-serif; color: #241e2a;\">",
      "<p>你好，</p>",
      `<p>我们正在招募参与「${escapeHtml(args.studyTitle)}」访谈的受访者。</p>`,
      "<p>如果你符合以下条件，欢迎参与：</p>",
      `<ul>${requirements.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      `<p><a href=\"${escapeHtml(interviewUrl)}\">进入访谈</a></p>`,
      `<p>如果按钮不可用，请复制此链接：${escapeHtml(interviewUrl)}</p>`,
      "<p>感谢你的时间。</p>",
      "</body></html>",
    ].join(""),
  };
}

export function parseRecruitmentRecipients(raw: string): string[] {
  const recipients = raw
    .split(/[\n,\r]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = RecipientEmailSchema.safeParse(value);
      if (!parsed.success) throw new Error("invalid_recipient_email");
      return parsed.data;
    });
  const unique = [...new Set(recipients)];
  if (!unique.length) throw new Error("recipient_required");
  if (unique.length > MAX_RECIPIENTS_PER_SEND) throw new Error("recipient_limit_exceeded");
  return unique;
}

export function recruitmentInvitationCampaignKey(args: {
  surveyId: string;
  linkId: string;
  criteriaUpdatedAt: string;
  recipientEmail: string;
}): string {
  const recipientHash = createHash("sha256").update(args.recipientEmail.toLowerCase()).digest("hex");
  return `recruitment_invitation:${args.surveyId}:${args.linkId}:${args.criteriaUpdatedAt}:${recipientHash}`;
}
