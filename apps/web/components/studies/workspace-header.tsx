import { Check, CircleDashed, MoreHorizontal, PauseCircle } from "lucide-react";
import { STATUS_LABELS, type StudyStatus } from "@/lib/guide";

/**
 * Study 工作台顶部标题栏:研究标题 + 单色状态 pill + 最后保存时间。
 *
 * 状态用「图标 + 文案 + 容器」表达,不依赖颜色(Mauve Quiet 单色原则)。
 */

const STATUS_ICON: Record<StudyStatus, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  live: Check,
  draft: CircleDashed,
  closed: PauseCircle,
};

// 容器深浅传达层级:进行中=最浅暖白,草稿/已结束=稍深 mauve。
const STATUS_SURFACE: Record<StudyStatus, string> = {
  live: "bg-mauve-50",
  draft: "bg-mauve-50",
  closed: "bg-mauve-100",
};

function StatusPill({ status }: { status: StudyStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-decor text-caption text-ink-900 ${STATUS_SURFACE[status]}`}
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function WorkspaceHeader({
  title,
  status,
  lastSaved,
}: {
  title: string;
  status: StudyStatus;
  lastSaved?: string;
}) {
  return (
    <header className="flex shrink-0 flex-col justify-center gap-0.5 border-b border-ink-200 px-4 py-2">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 max-w-xl truncate font-display text-body-sm font-semibold text-ink-900">
          {title || "未命名调研"}
        </h1>
        <button
          type="button"
          aria-label="更多操作"
          className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <MoreHorizontal className="size-4" strokeWidth={2} />
        </button>
        <StatusPill status={status} />
      </div>
      {lastSaved && (
        <p className="font-ui text-caption text-ink-400">最后保存 {lastSaved}</p>
      )}
    </header>
  );
}
