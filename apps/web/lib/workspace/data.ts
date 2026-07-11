import {
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
 * 迁移到 Appwrite 时,各视图无需改动:
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
 * 空结果返回明确空态; 真正读取失败则向上抛,交给页面边界处理,
 * 避免把线上故障伪装成看似真实的 mock 数据。
 */

const EMPTY_OVERVIEW: WorkspaceOverview = {
  responsesTotal: 0,
  completedInterviews: 0,
  paused: false,
  latest: [],
}

const EMPTY_RESULTS: ResultsTable = {
  questionColumns: [],
  rows: [],
  totalCount: 0,
}

export async function loadStudyOverview(studyId: string): Promise<WorkspaceOverview> {
  const owner = await getOwnerUserIdOrNull();
  if (!owner) return EMPTY_OVERVIEW;
  const sessions = await listSessions(studyId);
  if (sessions.length === 0) return EMPTY_OVERVIEW;
  return sessionsToOverview(sessions);
}

export async function loadStudyResults(studyId: string): Promise<ResultsTable> {
  const owner = await getOwnerUserIdOrNull();
  if (!owner) return EMPTY_RESULTS;
  const [sessions, questions] = await Promise.all([
    listSessions(studyId),
    listQuestionRefs(studyId),
  ]);
  if (sessions.length === 0) {
    return {
      ...EMPTY_RESULTS,
      questionColumns: questions.map((q) => q.prompt),
    }
  }
  return sessionsToResults(questions, sessions);
}

export async function loadStudyTranscript(
  sessionId: string,
  reportOwnerUserId?: string | null,
): Promise<TranscriptDetail | null> {
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
  if (!transcript) return null;

  let aiSummary = "";
  let visualAnalysis = null;
  let recording = null;
  if (owner && session?.surveyId) {
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
}

export async function loadStudyRecruit(studyId: string): Promise<RecruitMock> {
  return getMockRecruit(studyId);
}
