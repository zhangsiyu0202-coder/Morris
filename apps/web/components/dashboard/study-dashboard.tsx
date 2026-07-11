"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  BarChart3,
  Clock,
  FileText,
  LayoutGrid,
  ListPlus,
  Loader2,
  MessageSquareQuote,
  Plus,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import type { DashboardWidgetType, RunDashboardWidgetsOutput } from "@merism/contracts";
import type { StudyDashboardView } from "@/lib/dashboard/view-data";
import {
  addDashboardWidget,
  deleteDashboardTile,
  updateDashboardWidget,
} from "@/lib/dashboard/actions";
import { DASHBOARD_WIDGET_CATALOG } from "@/lib/dashboard/widget-catalog";
import { WidgetCard } from "./widget-card";

type Tile = StudyDashboardView["tiles"][number];
type WidgetResult = RunDashboardWidgetsOutput["results"][number];

const GROUP_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  study: LayoutGrid,
  sessions: Clock,
  analysis: BarChart3,
  evidence: MessageSquareQuote,
  video: Video,
};

function resultFor(tile: Tile, results: WidgetResult[]): WidgetResult | undefined {
  return results.find((item) => item.tileId === tile.$id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function EmptyLine({ label = "暂无数据" }: { label?: string }) {
  return <p className="font-ui text-body-sm text-ink-400">{label}</p>;
}

function StudyProgress({ result }: { result: unknown }) {
  const data = asRecord(result);
  const total = Number(data.totalSessions ?? 0);
  const completed = Number(data.completedSessions ?? 0);
  const rate = Number(data.completionRate ?? 0);
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="flex items-end gap-3">
        <span className="font-data text-display-xl text-ink-900">{completed}</span>
        <span className="pb-2 font-ui text-body-sm text-ink-400">/ {total} 完成</span>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded bg-mauve-100">
          <div className="h-full rounded bg-mauve-200" style={{ width: `${Math.min(rate, 100)}%` }} />
        </div>
        <p className="mt-2 font-ui text-caption text-ink-400">完成率 {rate}%</p>
      </div>
    </div>
  );
}

function RecentSessions({ result, surveyId }: { result: unknown; surveyId: string }) {
  const sessions = (asRecord(result).sessions as Array<Record<string, unknown>> | undefined) ?? [];
  if (sessions.length === 0) return <EmptyLine />;
  return (
    <div className="flex flex-col">
      {sessions.map((session) => (
        <Link
          key={String(session.sessionId)}
          href={`/studies/${surveyId}/results/${String(session.sessionId)}`}
          className="flex items-center justify-between gap-3 border-b border-ink-100 py-2 last:border-b-0"
        >
          <span className="min-w-0 truncate font-ui text-body-sm text-ink-900">
            {String(session.respondent ?? "匿名受访者")}
          </span>
          <span className="shrink-0 rounded bg-mauve-50 px-2 py-0.5 font-ui text-caption text-ink-500">
            {String(session.state ?? "")}
          </span>
        </Link>
      ))}
    </div>
  );
}

function TopThemes({ result }: { result: unknown }) {
  const themes = (asRecord(result).themes as Array<Record<string, unknown>> | undefined) ?? [];
  if (themes.length === 0) return <EmptyLine label="暂无整体报告主题" />;
  return (
    <div className="flex flex-col gap-2">
      {themes.map((theme) => (
        <div key={String(theme.id)} className="rounded bg-mauve-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="font-ui text-body-sm font-medium text-ink-900">{String(theme.label ?? "")}</p>
            {typeof theme.pct === "number" ? (
              <span className="font-data text-caption text-ink-500">{theme.pct}%</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function TopInsights({ result }: { result: unknown }) {
  const insights = (asRecord(result).insights as Array<Record<string, unknown>> | undefined) ?? [];
  if (insights.length === 0) return <EmptyLine label="暂无整体报告洞察" />;
  return (
    <div className="flex flex-col gap-3">
      {insights.map((insight) => (
        <div key={String(insight.id)}>
          <p className="font-ui text-body-sm font-semibold text-ink-900">{String(insight.title ?? "")}</p>
          <p className="mt-1 line-clamp-2 font-ui text-caption leading-5 text-ink-500">
            {String(insight.text ?? "")}
          </p>
        </div>
      ))}
    </div>
  );
}

function SentimentBreakdown({ result }: { result: unknown }) {
  const rows = (asRecord(result).sentimentBreakdown as Array<Record<string, unknown>> | undefined) ?? [];
  const total = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  if (rows.length === 0 || total === 0) return <EmptyLine label="暂无情绪统计" />;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const count = Number(row.count ?? 0);
        return (
          <div key={String(row.sentiment)}>
            <div className="mb-1 flex justify-between font-ui text-caption text-ink-500">
              <span>{String(row.sentiment)}</span>
              <span>{count}</span>
            </div>
            <div className="h-2 rounded bg-mauve-100">
              <div className="h-full rounded bg-mauve-200" style={{ width: `${(count / total) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookmarkedQuotes({ result }: { result: unknown }) {
  const bookmarks = (asRecord(result).bookmarks as Array<Record<string, unknown>> | undefined) ?? [];
  if (bookmarks.length === 0) return <EmptyLine label="暂无收藏原话" />;
  return (
    <div className="flex flex-col gap-3">
      {bookmarks.map((bookmark) => (
        <blockquote key={String(bookmark.id)} className="border-l-2 border-mauve-200 pl-3">
          <p className="line-clamp-2 font-reading text-body-sm leading-6 text-ink-700">
            {String(bookmark.quote ?? "")}
          </p>
          <p className="mt-1 font-ui text-caption text-ink-400">{String(bookmark.respondent ?? "")}</p>
        </blockquote>
      ))}
    </div>
  );
}

function VisualMoments({ result, surveyId }: { result: unknown; surveyId: string }) {
  const moments = (asRecord(result).moments as Array<Record<string, unknown>> | undefined) ?? [];
  if (moments.length === 0) return <EmptyLine label="暂无视频关键时刻" />;
  return (
    <div className="flex flex-col gap-3">
      {moments.map((moment) => (
        <Link
          key={`${String(moment.sessionId)}:${String(moment.timestampMs)}`}
          href={`/studies/${surveyId}/results/${String(moment.sessionId)}`}
          className="rounded bg-mauve-50 px-3 py-2"
        >
          <p className="font-ui text-body-sm font-medium text-ink-900">{String(moment.label ?? "")}</p>
          <p className="mt-1 line-clamp-2 font-ui text-caption leading-5 text-ink-500">
            {String(moment.description ?? "")}
          </p>
        </Link>
      ))}
    </div>
  );
}

function QuestionStats({ result }: { result: unknown }) {
  const stats = (asRecord(result).questionStats as Array<Record<string, unknown>> | undefined) ?? [];
  if (stats.length === 0) return <EmptyLine label="暂无问题统计" />;
  return (
    <div className="flex flex-col gap-3">
      {stats.map((stat, index) => (
        <div key={`${String(stat.questionId ?? index)}`} className="border-b border-ink-100 pb-2 last:border-b-0">
          <p className="line-clamp-1 font-ui text-body-sm font-medium text-ink-900">
            {String(stat.questionText ?? stat.reportQuestion ?? "问题")}
          </p>
          <p className="mt-1 line-clamp-2 font-ui text-caption leading-5 text-ink-500">
            {String(stat.summary ?? "")}
          </p>
        </div>
      ))}
    </div>
  );
}

function WidgetBody({
  widgetType,
  result,
  surveyId,
}: {
  widgetType: DashboardWidgetType;
  result: unknown;
  surveyId: string;
}) {
  if (result === null) return <EmptyLine />;
  switch (widgetType) {
    case "study_progress":
      return <StudyProgress result={result} />;
    case "recent_sessions":
      return <RecentSessions result={result} surveyId={surveyId} />;
    case "top_themes":
      return <TopThemes result={result} />;
    case "top_insights":
      return <TopInsights result={result} />;
    case "sentiment_breakdown":
      return <SentimentBreakdown result={result} />;
    case "bookmarked_quotes":
      return <BookmarkedQuotes result={result} />;
    case "visual_moments":
      return <VisualMoments result={result} surveyId={surveyId} />;
    case "question_stats":
      return <QuestionStats result={result} />;
  }
}

function AddWidgetModal({
  surveyId,
  onClose,
}: {
  surveyId: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const entries = Object.values(DASHBOARD_WIDGET_CATALOG);
  return (
    <Modal title="添加组件" onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => {
          const Icon = GROUP_ICON[entry.groupId] ?? Sparkles;
          return (
            <button
              key={entry.widgetType}
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await addDashboardWidget({ surveyId, widgetType: entry.widgetType });
                  onClose();
                });
              }}
              className="flex min-h-24 items-start gap-3 rounded border border-ink-100 bg-ink-0 px-3 py-3 text-left hover:bg-mauve-50 disabled:opacity-50"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-ink-600" strokeWidth={2} />
              <span>
                <span className="block font-ui text-body-sm font-semibold text-ink-900">{entry.label}</span>
                <span className="mt-1 line-clamp-2 block font-ui text-caption leading-5 text-ink-500">
                  {entry.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function EditWidgetModal({
  surveyId,
  tile,
  onClose,
}: {
  surveyId: string;
  tile: Tile;
  onClose: () => void;
}) {
  const [name, setName] = useState(tile.widget.name ?? "");
  const [limit, setLimit] = useState(
    typeof tile.widget.config.limit === "number" ? String(tile.widget.config.limit) : "",
  );
  const [pending, startTransition] = useTransition();
  return (
    <Modal title="编辑组件" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="font-ui text-body-sm font-medium text-ink-800">标题</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 rounded border border-ink-200 bg-ink-0 px-3 font-ui text-body-sm outline-none focus:border-mauve-400"
          />
        </label>
        {"limit" in tile.widget.config ? (
          <label className="flex flex-col gap-1.5">
            <span className="font-ui text-body-sm font-medium text-ink-800">数量</span>
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="h-10 rounded border border-ink-200 bg-ink-0 px-3 font-ui text-body-sm outline-none focus:border-mauve-400"
            />
          </label>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await updateDashboardWidget({
                surveyId,
                widgetId: tile.widget.$id,
                name,
                limit: limit ? Number(limit) : undefined,
              });
              onClose();
            });
          }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 hover:bg-mauve-100 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          保存
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4">
      <div className="w-full max-w-2xl rounded border border-ink-100 bg-ink-0 shadow-[0_16px_40px_rgba(167,133,133,0.22)]">
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="font-display text-display-sm text-ink-900">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded hover:bg-mauve-100"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function StudyDashboard({ view }: { view: StudyDashboardView }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Tile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sortedTiles = useMemo(
    () => [...view.tiles].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x || a.order - b.order),
    [view.tiles],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-ui text-caption font-semibold uppercase text-ink-400">Dashboard</p>
          <h1 className="mt-1 font-display text-display-md text-ink-900">{view.studyTitle}</h1>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm font-medium text-ink-900 hover:bg-mauve-50"
        >
          <Plus className="size-4" strokeWidth={2} />
          添加组件
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {sortedTiles.map((tile) => {
          const entry = DASHBOARD_WIDGET_CATALOG[tile.widget.widgetType];
          const Icon = GROUP_ICON[entry.groupId] ?? FileText;
          const run = resultFor(tile, view.widgetResults);
          return (
            <div key={tile.$id} className="min-h-64 lg:col-span-6 xl:col-span-4">
              <WidgetCard
                title={tile.widget.name ?? entry.label}
                eyebrow={entry.groupLabel}
                description={tile.widget.description ?? entry.description}
                onEdit={() => setEditing(tile)}
                onDelete={() => {
                  setDeletingId(tile.$id);
                  startTransition(async () => {
                    await deleteDashboardTile({ surveyId: view.dashboard.surveyId, tileId: tile.$id });
                    setDeletingId(null);
                  });
                }}
              >
                {deletingId === tile.$id ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-ink-400" />
                  </div>
                ) : run?.error ? (
                  <EmptyLine label={run.error} />
                ) : (
                  <div className="flex h-full flex-col gap-3">
                    <div className="hidden items-center gap-2 font-ui text-caption text-ink-400">
                      <Icon className="size-3.5" strokeWidth={2} />
                      {entry.label}
                    </div>
                    <WidgetBody
                      widgetType={tile.widget.widgetType}
                      result={run?.result ?? null}
                      surveyId={view.dashboard.surveyId}
                    />
                  </div>
                )}
              </WidgetCard>
            </div>
          );
        })}
      </div>

      {sortedTiles.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex min-h-56 flex-col items-center justify-center gap-3 rounded border border-dashed border-mauve-200 bg-mauve-50"
        >
          <ListPlus className="size-6 text-ink-500" strokeWidth={2} />
          <span className="font-ui text-body-sm font-medium text-ink-800">添加第一个组件</span>
        </button>
      ) : null}

      {addOpen ? <AddWidgetModal surveyId={view.dashboard.surveyId} onClose={() => setAddOpen(false)} /> : null}
      {editing ? (
        <EditWidgetModal surveyId={view.dashboard.surveyId} tile={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
