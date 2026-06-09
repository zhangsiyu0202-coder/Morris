import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Quote,
  GitCompareArrows,
  ListChecks,
} from "lucide-react";
import type { NotebookReport } from "@/lib/notebooks";

const CONFIDENCE_LABEL: Record<NotebookReport["confidence"], string> = {
  high: "高置信度",
  medium: "中等置信度",
  low: "低置信度",
};

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-mauve-300 text-ink-900",
  P1: "bg-mauve-200 text-ink-800",
  P2: "bg-mauve-100 text-ink-600",
};

export function NotebookDetail({
  studyTitle,
  question,
  report,
}: {
  studyTitle: string;
  question: string;
  report: NotebookReport;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* 返回 */}
      <Link
        href="/notebooks"
        className="inline-flex items-center gap-1.5 font-ui text-body-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft size={14} /> 全部洞察
      </Link>

      {/* 标题区:用户的问题作为主标题 */}
      <header className="mt-4 border-b border-mauve-200 pb-6">
        <p className="font-ui text-caption uppercase tracking-[0.14em] text-ink-400">
          {studyTitle}
        </p>
        <h1 className="mt-2 text-balance font-display text-h1 leading-tight text-ink-900">
          {question}
        </h1>
        <p className="mt-3 font-ui text-body-sm leading-6 text-ink-500">
          基于该调研的真实会话内容,围绕这一问题的深入分析报告。
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-8">
        {/* 结论在先:直接回答 + 置信度 */}
        <section className="rounded bg-mauve-100 px-6 py-5">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-ink-500" />
            <span className="font-ui text-caption font-medium uppercase tracking-wide text-ink-500">
              结论
            </span>
            <span className="ml-auto rounded-full bg-mauve-200 px-2.5 py-0.5 font-ui text-caption font-medium text-ink-700">
              {CONFIDENCE_LABEL[report.confidence]}
            </span>
          </div>
          <p className="mt-3 text-balance font-display text-h2 leading-snug text-ink-900">
            {report.headline}
          </p>
          <p className="mt-3 text-pretty font-ui text-body-lg leading-7 text-ink-800">
            {report.directAnswer}
          </p>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            {report.confidenceReason}
          </p>
        </section>

        {/* 证据支撑:逐维度分析 */}
        <section>
          <h2 className="font-display text-h3 text-ink-900">逐维度论证</h2>
          <div className="mt-4 flex flex-col gap-5">
            {report.themes.map((t, i) => (
              <article key={i} className="rounded border border-mauve-200 px-5 py-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-data text-body-sm text-ink-300">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-body-lg font-medium text-ink-900">
                    {t.title}
                  </h3>
                </div>
                <p className="mt-2 font-ui text-body-sm leading-7 text-ink-700">{t.analysis}</p>
                {t.quotes.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {t.quotes.map((q, qi) => (
                      <li
                        key={qi}
                        className="flex gap-2 rounded bg-mauve-50 px-3 py-2 font-ui text-body-sm italic leading-6 text-ink-600"
                      >
                        <Quote size={13} className="mt-1 shrink-0 text-ink-300" />
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* 观点分歧 */}
        {report.divergences.length > 0 && (
          <section>
            <div className="flex items-center gap-2">
              <GitCompareArrows size={16} className="text-ink-500" />
              <h2 className="font-display text-h3 text-ink-900">观点分歧</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {report.divergences.map((d, i) => (
                <div key={i} className="rounded border border-mauve-200 bg-mauve-50 px-4 py-3">
                  <p className="font-ui text-caption font-medium uppercase tracking-wide text-ink-400">
                    {d.group}
                  </p>
                  <p className="mt-1.5 font-ui text-body-sm leading-6 text-ink-800">{d.stance}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 行动建议 */}
        <section>
          <div className="flex items-center gap-2">
            <ListChecks size={16} className="text-ink-500" />
            <h2 className="font-display text-h3 text-ink-900">行动建议</h2>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {report.actions.map((a, i) => (
              <div key={i} className="flex gap-3 rounded border border-mauve-200 px-4 py-3">
                <span
                  className={`mt-0.5 h-fit shrink-0 rounded px-2 py-0.5 font-data text-caption font-semibold ${
                    PRIORITY_STYLE[a.priority] ?? "bg-mauve-100 text-ink-600"
                  }`}
                >
                  {a.priority}
                </span>
                <div>
                  <p className="font-ui text-body-sm font-medium leading-6 text-ink-900">
                    {a.action}
                  </p>
                  <p className="mt-1 font-ui text-body-sm leading-6 text-ink-500">{a.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
