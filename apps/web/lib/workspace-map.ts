import type { InterviewSession } from "@merism/contracts";
import type {
  WorkspaceOverview,
  SessionDisplayStatus,
  LatestInterview,
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
