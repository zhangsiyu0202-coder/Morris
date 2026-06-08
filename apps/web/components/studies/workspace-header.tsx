import { Archive, Check, CircleDashed, PauseCircle, XCircle } from "lucide-react";
import { STATUS_LABELS, type StudyStatus } from "@/lib/guide";
import { StudyStatusActions } from "./study-status-actions";

/**
 * Study 工作台顶部标题栏:研究标题 + 单色状态 pill + 状态操作 + 最后保存时间。
 *
 * 状态用「图标 + 文案 + 容器」表达,不依赖颜色(Mauve Quiet 单色原则)。
 * StudyStatusActions 是 client 组件,挂载在此服务端组件中无水合问题。
 */

const STATUS_ICON: Record<StudyStatus, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  live: Check,
  draft: CircleDashed,
  paused: PauseCircle,
  closed: XCircle,
  archived: Archive,
};

// 容器深浅传达层级:进行中=最浅暖白,草稿/已结束=稍深 mauve,暂停=mauve-100。
const STATUS_SURFACE: Record<StudyStatus, string> = {
  live: "bg-mauve-50",
  draft: "bg-mauve-50",
  paused: "bg-mauve-100",
  closed: "bg-mauve-100",
  archived: "bg-mauve-100",
};

function StatusPill({ status }: { status: StudyStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-decor text-body-sm text-ink-900 ${STATUS_SURFACE[status]}`}
    >
      <Icon className="size-4" strokeWidth={2} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function WorkspaceHeader({
  surveyId,
  title,
  status,
  lastSaved,
}: {
  surveyId: string;
  title: string;
  status: StudyStatus;
  lastSaved?: string;
}) {
  return (
    <header className="flex shrink-0 flex-col justify-center gap-1 border-b border-ink-200 px-6 py-4">
      <div className="flex items-center gap-3">
        <h1 className="min-w-0 max-w-xl truncate font-display text-display-lg font-semibold text-ink-900">
          {title || "未命名调研"}
        </h1>
        <StudyStatusActions surveyId={surveyId} status={status} />
        <StatusPill status={status} />
      </div>
      {lastSaved && (
        <p className="font-ui text-body-sm text-ink-400">最后保存 {lastSaved}</p>
      )}
    </header>
  );
}
