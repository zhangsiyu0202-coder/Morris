import type { InterviewSession, Transcript } from "@merism/contracts";
import type {
  WorkspaceOverview,
  SessionDisplayStatus,
  LatestInterview,
  ResultsTable,
  ResultRow,
  TranscriptDetail,
  TranscriptTurn,
} from "@/lib/mock/workspace";

/**
 * 把契约 `InterviewSession[]` 映射为概览视图数据(纯函数,可单测)。
 * 只用契约里明确定义的字段(`state` / `startedAt` / `$id`),不触碰自由形态的
 * `collectedAnswers`(那属于 results 视图,形态依赖 agent 写入,待 ai-interview-engine)。
 */

function toDisplayStatus(state: InterviewSession["state"]): SessionDisplayStatus {
  if (state === "completed") return "completed";
  if (state === "in_progress" || state === "created") return "in_progress";
  return "incomplete"; // abandoned / failed
}

/** ISO -> "YYYY-MM-DD HH:mm"(本地无关,纯字符串切片,避免时区/水合漂移)。 */
function fmt(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

export function sessionsToOverview(
  sessions: InterviewSession[],
  opts?: { paused?: boolean; limit?: number },
): WorkspaceOverview {
  const limit = opts?.limit ?? 6;
  const latest: LatestInterview[] = [...sessions]
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
    .slice(0, limit)
    .map((s) => ({
      sessionId: s.$id,
      datetime: fmt(s.startedAt),
      status: toDisplayStatus(s.state),
    }));

  return {
    responsesTotal: sessions.length,
    completedInterviews: sessions.filter((s) => s.state === "completed").length,
    paused: opts?.paused ?? false,
    latest,
  };
}

/** 调研的问题引用(用于结果表头与答案列对齐)。 */
export type QuestionRef = { id: string; prompt: string };

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * collectedAnswers 的值规整为可显示字符串。
 * 约定:`collectedAnswers[questionId]` 可为 string | {text} | string[] | 其它。
 * 注:真实键约定由 ai-interview-engine 定稿,届时在此对齐。
 */
function answerToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(answerToString).filter(Boolean).join("、");
  if (typeof v === "object") {
    const t = (v as { text?: unknown; value?: unknown }).text ?? (v as { value?: unknown }).value;
    return t == null ? "" : String(t);
  }
  return String(v);
}

export function sessionsToResults(
  questions: QuestionRef[],
  sessions: InterviewSession[],
): ResultsTable {
  const questionColumns = questions.map((q, i) => `Q${i + 1}: ${truncate(q.prompt, 28)}`);

  const rows: ResultRow[] = sessions.map((s) => {
    const answers = questions.map((q) =>
      answerToString((s.collectedAnswers as Record<string, unknown>)?.[q.id]),
    );
    return {
      sessionId: s.$id,
      date: fmt(s.startedAt).slice(0, 10),
      status: toDisplayStatus(s.state),
      task: "访谈",
      summary: answers.find((a) => a.length > 0) ?? "",
      answers,
    };
  });

  return { questionColumns, rows, totalCount: sessions.length };
}

function durationLabel(startedAt?: string, endedAt?: string): string {
  if (!startedAt || !endedAt) return "—";
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min} 分 ${sec} 秒`;
}

const STATUS_TEXT: Record<SessionDisplayStatus, string> = {
  completed: "已完成",
  in_progress: "进行中",
  incomplete: "未完成",
};

export function transcriptToDetail(
  transcript: Transcript,
  session: InterviewSession | null,
  aiSummary: string,
): TranscriptDetail {
  const turns: TranscriptTurn[] = transcript.segments.map((seg) => ({
    speaker: /interview|agent|主持|host/i.test(seg.speaker) ? "interviewer" : "respondent",
    text: seg.text,
  }));

  const status = session ? toDisplayStatus(session.state) : "completed";
  const metadata = [
    { key: "session_id", value: transcript.sessionId },
    { key: "language", value: transcript.language },
    { key: "started", value: fmt(session?.startedAt) || "—" },
    { key: "duration", value: durationLabel(session?.startedAt, session?.endedAt) },
    { key: "status", value: STATUS_TEXT[status] },
  ];

  return {
    sessionId: transcript.sessionId,
    datetime: fmt(session?.startedAt) || fmt(transcript.finalizedAt),
    language: transcript.language,
    turns,
    aiSummary: aiSummary || "（本次访谈暂无 AI 摘要）",
    metadata,
  };
}
