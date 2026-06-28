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
import { getOwnerUserIdOrNull } from "@/lib/auth/owner";
import { sessionsToOverview, sessionsToResults, transcriptToDetail, sessionReportToSummary } from "@/lib/workspace/map";
import { listSessions } from "@/lib/queries";
import { getLatestAnalysisReport, parseSessionReportBody } from "@/lib/queries/reports";
import { getRecordingBySession } from "@/lib/queries/recordings";
import { listQuestionRefs, getSessionById, getTranscriptBySession } from "@/lib/survey/read";

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
    const owner = await getOwnerUserIdOrNull();
    if (!owner) return getMockOverview(studyId);
    const sessions = await listSessions(studyId);
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
    const owner = await getOwnerUserIdOrNull();
    if (!owner) return getMockResults(studyId);
    // Both reads depend only on studyId — run in parallel. We still treat 0
    // sessions as the empty-state mock, but we save one round trip on the
    // hot path where sessions exist.
    const [sessions, questions] = await Promise.all([
      listSessions(studyId),
      listQuestionRefs(studyId),
    ]);
    if (sessions.length === 0) return getMockResults(studyId);
    return sessionsToResults(questions, sessions);
  } catch {
    return getMockResults(studyId);
  }
}

export async function loadStudyTranscript(
  sessionId: string,
  reportOwnerUserId?: string | null,
): Promise<TranscriptDetail> {
  try {
    // transcript / session / owner are independent of each other. Resolve them
    // together so this RSC's TTFB is bounded by the slowest single read instead
    // of the sum of three. Owner lookup matches the original `??` semantics —
    // null OR undefined fall through to getOwnerUserIdOrNull().
    const ownerPromise =
      reportOwnerUserId == null
        ? getOwnerUserIdOrNull()
        : Promise.resolve(reportOwnerUserId);
    const [transcript, session, owner] = await Promise.all([
      getTranscriptBySession(sessionId),
      getSessionById(sessionId),
      ownerPromise,
    ]);
    if (!transcript) return getMockTranscript(sessionId);

    let aiSummary = "";
    let visualAnalysis = null;
    let recording = null;
    if (owner && session?.surveyId) {
      // analysis report (by ownerUserId + surveyId + sessionId) and recording
      // (by sessionId) are independent and read the same Appwrite shape; pair
      // them on the wire.
      const [report, recordingDoc] = await Promise.all([
        getLatestAnalysisReport(owner, {
          scope: "session",
          sessionId,
          surveyId: session.surveyId,
        }),
        getRecordingBySession(sessionId),
      ]);
      const body = report ? parseSessionReportBody(report) : null;
      if (body) {
        aiSummary = sessionReportToSummary(body);
        visualAnalysis = body.visualAnalysis ?? null;
      }
      recording = recordingDoc;
    }
    return transcriptToDetail(transcript, session, aiSummary, recording, visualAnalysis);
  } catch {
    return getMockTranscript(sessionId);
  }
}

export async function loadStudyRecruit(studyId: string): Promise<RecruitMock> {
  return getMockRecruit(studyId);
}
