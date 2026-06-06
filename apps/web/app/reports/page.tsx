import Link from "next/link";
import { ArrowRight, FileBarChart } from "lucide-react";
import {
  countCompletedSessions,
  getCurrentUserId,
  listStudies,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "分析报告 · Reports",
  description: "查看每个调研基于完成访谈生成的聚合分析报告。",
};

export default async function ReportsListPage() {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return <SignedOutEmpty />;

  const studies = await listStudies(ownerUserId);
  const cards = await Promise.all(
    studies.map(async (study) => ({
      surveyId: study.$id,
      title: study.title,
      status: study.status,
      completedRespondents: await countCompletedSessions(ownerUserId, study.$id),
      updatedAt: study.updatedAt,
    })),
  );
  // Show only studies with at least one completed session — empty studies
  // would render the empty state forever and clutter the list.
  const visible = cards.filter((c) => c.completedRespondents > 0);

  return (
    <main className="min-h-full bg-mauve-50 px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-2">
          <p className="font-ui text-caption font-medium uppercase tracking-wider text-ink-400">
            Reports
          </p>
          <h1 className="font-display text-display-lg text-ink-900">分析报告</h1>
          <p className="max-w-xl font-ui text-body-sm leading-6 text-ink-600">
            点击调研卡片进入聚合报告;每条记录对应一份基于完成访谈生成的 survey 级报告。
          </p>
        </header>

        {visible.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <Link
                key={c.surveyId}
                href={`/reports/${c.surveyId}`}
                className="group flex flex-col gap-3 rounded border border-ink-100 bg-ink-0 p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-9 items-center justify-center rounded bg-mauve-100 text-ink-900">
                    <FileBarChart className="size-4" strokeWidth={2} />
                  </span>
                  <ArrowRight
                    className="size-4 text-ink-400 transition-colors group-hover:text-ink-900"
                    aria-hidden
                  />
                </div>
                <h2 className="font-ui text-body font-semibold leading-6 text-ink-900">
                  {c.title}
                </h2>
                <p className="font-ui text-body-sm text-ink-400">
                  {c.completedRespondents} 份完成访谈
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function SignedOutEmpty() {
  return (
    <main className="min-h-full bg-mauve-50 px-4 py-12 sm:px-8">
      <div className="mx-auto max-w-md rounded border border-dashed border-ink-200 bg-ink-0 p-10 text-center">
        <h2 className="font-ui text-body font-semibold text-ink-900">请先登录</h2>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-400">
          只有研究员账号能查看分析报告。
        </p>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center justify-center rounded border border-dashed border-ink-200 bg-ink-0 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-mauve-100">
        <FileBarChart className="size-6 text-ink-900" strokeWidth={2} />
      </div>
      <h2 className="mt-4 font-ui text-body font-semibold text-ink-900">尚无可生成报告的调研</h2>
      <p className="mt-1.5 max-w-sm font-ui text-body-sm leading-6 text-ink-400">
        创建一个调研、邀请受访者完成至少一次访谈,系统会自动生成 survey 级聚合报告。
      </p>
    </div>
  );
}
