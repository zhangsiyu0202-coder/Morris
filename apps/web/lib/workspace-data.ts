import {
  getMockOverview,
  getMockResults,
  getMockTranscript,
  getMockRecruit,
  type WorkspaceOverview,
  type ResultsTable,
  type TranscriptDetail,
  type RecruitMock,
} from "@/lib/mock/workspace";
import { getOwnerUserId } from "@/lib/owner";
import { sessionsToOverview, sessionsToResults, transcriptToDetail } from "@/lib/workspace-map";
import { listSessions } from "@/lib/queries";
import { listQuestionRefs, getSessionById, getTranscriptBySession } from "@/lib/survey-read";

/**
 * 工作台各视图的**服务端数据访问层(seam)**。
 *
 * 现状:返回 `lib/mock/workspace` 的 mock(UI 阶段)。
 *
 * 迁移到 Appwrite 时,只改本文件,各视图无需改动:
 * - 概览/结果:`getCurrentUserId()` + `listSessions(ownerUserId, surveyId)`
 *   (`@/lib/queries`),把 `InterviewSession` 映射到 `LatestInterview`/`ResultRow`,
 *   `collectedAnswers` 展开为答案列。
 * - 转录:按 `sessionId` 取 `Transcript.segments` 映射为 `TranscriptTurn[]`,
 *   AI 摘要取自该 session 的 `AnalysisReport`。
 * - 招募:`shareableUrl` 由匿名链接 token(`issueLivekitToken` 体系)生成。
 *
 * 注意:当前工作台的 studyId 来自 Drizzle `study` 表,与 Appwrite `surveys`
 * 的 `$id` 不在同一 id 空间。真正切换前需先由 survey-editor 子规范把编辑器的
 * 读写路径迁到 Appwrite(并在本地 stack 上验证),届时 studyId 即 surveyId。
 *
 * 任一 Appwrite 读取在 `appwrite_not_configured` / 未登录 / 空结果时,
 * 应回退到对应 mock,保证本地无 stack 时页面仍可用。
 */

export async function loadStudyOverview(studyId: string): Promise<WorkspaceOverview> {
  try {
    const sessions = await listSessions(getOwnerUserId(), studyId);
    // No sessions yet -> show the illustrative mock rather than an empty panel.
    if (sessions.length === 0) return getMockOverview(studyId);
    return sessionsToOverview(sessions);
  } catch {
    // appwrite_not_configured / not reachable -> mock (local dev without stack).
    return getMockOverview(studyId);
  }
}

export async function loadStudyResults(studyId: string): Promise<ResultsTable> {
  try {
    const sessions = await listSessions(getOwnerUserId(), studyId);
    if (sessions.length === 0) return getMockResults(studyId);
    const questions = await listQuestionRefs(studyId);
    return sessionsToResults(questions, sessions);
  } catch {
    return getMockResults(studyId);
  }
}

export async function loadStudyTranscript(sessionId: string): Promise<TranscriptDetail> {
  try {
    const transcript = await getTranscriptBySession(sessionId);
    if (!transcript) return getMockTranscript(sessionId);
    const session = await getSessionById(sessionId);
    // AI summary comes from the session-level AnalysisReport once
    // analysis-report's parseSessionReportBody is implemented; "" for now ->
    // transcriptToDetail renders a neutral placeholder.
    return transcriptToDetail(transcript, session, "");
  } catch {
    return getMockTranscript(sessionId);
  }
}

export async function loadStudyRecruit(studyId: string): Promise<RecruitMock> {
  return getMockRecruit(studyId);
}
