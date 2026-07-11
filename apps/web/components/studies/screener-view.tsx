import { ClipboardList } from "lucide-react";

/** 筛选问卷:空状态引导(可选功能)。 */
export function ScreenerView() {
  return (
    <div className="grid h-full place-items-center px-6 py-10">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="grid size-12 place-items-center rounded-full bg-mauve-100">
          <ClipboardList className="size-6 text-ink-900" strokeWidth={1.5} />
        </span>
        <h2 className="mt-4 font-display text-display-md text-ink-900">
          添加筛选问卷 <span className="font-reading text-ink-400">(可选)</span>
        </h2>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-400">
          筛选问卷会在访谈开始前自动展示,用于进一步筛选合适的候选受访者。
        </p>
        <button
          type="button"
          className="mt-6 inline-flex h-10 items-center rounded bg-mauve-200 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
        >
          创建筛选问卷
        </button>
      </div>
    </div>
  );
}
