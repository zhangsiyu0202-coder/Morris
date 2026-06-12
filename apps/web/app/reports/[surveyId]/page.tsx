import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  countCompletedSessions,
  getCurrentUserId,
  getLatestAnalysisReport,
  getStudy,
  parseSurveyReportBody,
} from "@/lib/queries";
import { scopeForOwner } from "@/lib/auth/workspace";
import { ReportHeader } from "@/components/report/report-header";
import { SummarySection } from "@/components/report/summary-section";
import { HighlightsSection } from "@/components/report/highlights-section";
import { FindingsSection } from "@/components/report/findings-section";
import { AnalysisSection } from "@/components/report/analysis-section";
import { RegenerateButton } from "./regenerate-button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "分析报告 · MerismV2",
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) return <NotAllowed />;

  const scope = await scopeForOwner(ownerUserId);
  const study = await getStudy(scope, surveyId);
  if (!study) return <NotFound />;

  const completed = await countCompletedSessions(scope, surveyId);
  const stored = await getLatestAnalysisReport(ownerUserId, {
    surveyId,
    scope: "survey",
  });
  const body = stored ? parseSurveyReportBody(stored) : null;

  // D5 triptych: empty / loading / rendered.
  if (completed === 0) {
    return <EmptyState surveyTitle={study.survey.title} />;
  }
  if (!body) {
    return (
      <LoadingState surveyId={surveyId} surveyTitle={study.survey.title} completed={completed} />
    );
  }

  return (
    <main className="min-h-dvh bg-ink-0">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <BackLink />
        <ReportHeader report={body} />
        <SummarySection report={body} />
        <HighlightsSection insights={body.insights} />
        <FindingsSection stats={body.questionStats} />
        <AnalysisSection sentiment={body.sentimentBreakdown} themes={body.themes} />
        <RegenerateButton surveyId={surveyId} />
      </div>
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/reports"
      className="inline-flex w-fit items-center gap-1.5 rounded text-ink-500 transition-colors hover:text-ink-800"
    >
      <ArrowLeft className="size-4" /> 返回报告列表
    </Link>
  );
}

function NotAllowed() {
  return (
    <main className="min-h-dvh bg-mauve-50 px-4 py-12">
      <div className="mx-auto max-w-md rounded border border-dashed border-ink-200 bg-ink-0 p-10 text-center">
        <h2 className="font-ui text-body font-semibold text-ink-900">请先登录</h2>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
          只有研究员账号能查看分析报告。
        </p>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="min-h-dvh bg-mauve-50 px-4 py-12">
      <div className="mx-auto max-w-md rounded border border-dashed border-ink-200 bg-ink-0 p-10 text-center">
        <h2 className="font-ui text-body font-semibold text-ink-900">未找到这份调研</h2>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
          调研可能已被删除,或链接已失效。
        </p>
        <Link
          href="/reports"
          className="mt-5 inline-flex items-center gap-1.5 rounded bg-ink-900 px-4 py-2 font-ui text-body-sm font-medium text-mauve-50 transition-opacity hover:opacity-90"
        >
          <ArrowLeft className="size-4" /> 返回列表
        </Link>
      </div>
    </main>
  );
}

function EmptyState({ surveyTitle }: { surveyTitle: string }) {
  return (
    <main className="min-h-dvh bg-ink-0">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <BackLink />
        <header className="mt-6 flex flex-col gap-2">
          <p className="font-ui text-caption font-medium uppercase tracking-wider text-ink-400">
            分析报告
          </p>
          <h1 className="font-display text-display-lg text-ink-900">{surveyTitle}</h1>
        </header>
        <div className="mt-8 rounded border border-dashed border-ink-200 bg-mauve-50 px-6 py-12 text-center">
          <h2 className="font-ui text-body font-semibold text-ink-900">尚无完成的访谈</h2>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            访谈完成后,系统会自动生成 survey 级报告。也可以等到至少一次完成访谈后回到此页面。
          </p>
        </div>
      </div>
    </main>
  );
}

function LoadingState({
  surveyId,
  surveyTitle,
  completed,
}: {
  surveyId: string;
  surveyTitle: string;
  completed: number;
}) {
  return (
    <main className="min-h-dvh bg-ink-0">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <BackLink />
        <header className="mt-6 flex flex-col gap-2">
          <p className="font-ui text-caption font-medium uppercase tracking-wider text-ink-400">
            分析报告
          </p>
          <h1 className="font-display text-display-lg text-ink-900">{surveyTitle}</h1>
          <p className="font-ui text-body-sm text-ink-500">
            已收集 {completed} 份完成访谈,聚合报告生成中…
          </p>
        </header>
        <div className="mt-8 flex flex-col items-center justify-center rounded border border-dashed border-ink-200 bg-mauve-50 px-6 py-12 text-center">
          <h2 className="font-ui text-body font-semibold text-ink-900">报告正在生成</h2>
          <p className="mt-2 max-w-md font-ui text-body-sm leading-6 text-ink-500">
            访谈完成后,agent 会触发分析任务。如果等待超过几分钟,可手动刷新或重新生成。
          </p>
          <RegenerateButton surveyId={surveyId} variant="primary" />
        </div>
      </div>
    </main>
  );
}
