import Link from "next/link";
import { ArrowRight, Check, CircleDot, Clock, TriangleAlert } from "lucide-react";
import {
  SESSION_STATUS_LABELS,
  type SessionDisplayStatus,
  type WorkspaceOverview,
} from "@/lib/mock/workspace";

/**
 * 概览视图:左侧统计列 + 右侧最近访谈列表。
 * 状态用图标 + 文案表达(单色),不使用绿色/琥珀色。
 */

const STATUS_ICON: Record<
  SessionDisplayStatus,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  completed: Check,
  in_progress: CircleDot,
  incomplete: Clock,
};

function StatusBadge({ status }: { status: SessionDisplayStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-mauve-50 px-2.5 py-0.5 font-decor text-caption text-ink-900">
      <Icon className="size-3.5" strokeWidth={2} />
      {SESSION_STATUS_LABELS[status]}
    </span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-data text-display-xl text-ink-900">{value}</div>
      <div className="mt-0.5 font-ui text-caption text-ink-400">{label}</div>
    </div>
  );
}

export function OverviewView({
  studyId,
  overview,
}: {
  studyId: string;
  overview: WorkspaceOverview;
}) {
  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-6 py-6">
      {/* 左:统计列 */}
      <div className="w-44 shrink-0 pr-6">
        <p className="mb-3 font-ui text-caption font-semibold uppercase tracking-wide text-ink-400">
          项目概览
        </p>
        <div className="flex flex-col gap-4">
          <Stat value={overview.responsesTotal} label="响应总数" />
          <Stat value={overview.completedInterviews} label="已完成访谈" />
          <button
            type="button"
            className="mt-1 inline-flex h-9 items-center justify-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
          >
            发布调研
          </button>
        </div>
      </div>

      {/* 右:横幅 + 最近访谈 */}
      <div className="min-w-0 flex-1">
        {overview.paused && (
          <div className="mb-5 flex items-start gap-2.5 rounded-md border border-ink-200 bg-mauve-100 px-4 py-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-ink-900" strokeWidth={2} />
            <p className="font-ui text-body-sm leading-6 text-ink-900">
              调研已暂停。尝试访问调研链接的受访者将看到「调研已关闭」的提示。
            </p>
          </div>
        )}

        <p className="mb-3 font-ui text-body-sm font-semibold text-ink-900">最近访谈</p>

        <div className="flex flex-col">
          {overview.latest.map((item) => (
            <div
              key={item.sessionId}
              className="flex items-center justify-between gap-4 border-b border-ink-100 py-2.5"
            >
              <span className="w-40 shrink-0 font-data text-body-sm text-ink-600">
                {item.datetime}
              </span>
              <div className="flex-1">
                <StatusBadge status={item.status} />
              </div>
              <Link
                href={`/studies/${studyId}/results/${item.sessionId}`}
                className="inline-flex shrink-0 items-center gap-1 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:text-ink-600"
              >
                查看转录 <ArrowRight className="size-3.5" strokeWidth={2} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
