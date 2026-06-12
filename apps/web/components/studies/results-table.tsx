"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  CircleDot,
  Clock,
} from "lucide-react";
import type { Recording } from "@merism/contracts";
import {
  SESSION_STATUS_LABELS,
  type ResultsTable,
  type SessionDisplayStatus,
} from "@/lib/mock/workspace";
import { buildResultsCsv } from "@/lib/survey/export-results-csv";
import { RecordingDownloadButton } from "@/components/studies/recording-download-button";

/**
 * 结果大表:筛选 chip + 数据表 + 分页 + 导出。
 * 状态单色(图标 + 文案);表格正文用 font-data。
 */

const PAGE_SIZE = 20;

const FILTERS: { key: "all" | SessionDisplayStatus; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "in_progress", label: "进行中" },
  { key: "completed", label: "已完成" },
  { key: "incomplete", label: "未完成" },
];

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
    <span className="inline-flex items-center gap-1 rounded-full bg-mauve-50 px-2 py-0.5 font-decor text-caption text-ink-900">
      <Icon className="size-3" strokeWidth={2} />
      {SESSION_STATUS_LABELS[status]}
    </span>
  );
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ResultsTableView({
  studyId,
  table,
  recordingsBySessionId,
}: {
  studyId: string;
  table: ResultsTable;
  recordingsBySessionId: Record<string, Recording>;
}) {
  const [activeFilter, setActiveFilter] = useState<"all" | SessionDisplayStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const rows =
    activeFilter === "all"
      ? table.rows
      : table.rows.filter((r) => r.status === activeFilter);

  useEffect(() => {
    setPage(1);
  }, [activeFilter]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const allChecked =
    paginatedRows.length > 0 && paginatedRows.every((r) => selected.has(r.sessionId));

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of paginatedRows) next.delete(r.sessionId);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of paginatedRows) next.add(r.sessionId);
        return next;
      });
    }
  };

  const selectedIds = [...selected];
  const singleSelectedId = selected.size === 1 ? selectedIds[0] : null;
  const canDownloadRecording =
    singleSelectedId !== null && recordingsBySessionId[singleSelectedId] !== undefined;

  const recordingDisabledReason =
    selected.size === 0
      ? "请先选择一条记录"
      : selected.size > 1
        ? "请只选一条"
        : !canDownloadRecording
          ? "暂无录像"
          : null;

  const handleExportCsv = () => {
    if (selected.size === 0) return;
    const csv = buildResultsCsv(table, selectedIds);
    downloadCsv(csv, `results-${studyId}.csv`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 筛选条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-200 px-4 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded border border-ink-200 px-2.5 py-1 font-ui text-caption font-medium text-ink-600 transition-colors hover:bg-mauve-50"
        >
          <SlidersHorizontal className="size-3.5" strokeWidth={2} />
          筛选结果
        </button>
        <span className="mx-1 h-4 w-px bg-ink-200" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const active = activeFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                aria-pressed={active}
                className={`rounded-full px-2.5 py-1 font-ui text-caption transition-colors ${
                  active
                    ? "bg-ink-900 font-medium text-ink-0"
                    : "border border-ink-200 text-ink-400 hover:bg-mauve-50"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 表格 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-data text-body-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-mauve-50">
              <th className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="全选当前页"
                  className="accent-ink-900"
                />
              </th>
              {[
                { label: "日期", w: "w-24" },
                { label: "状态", w: "w-28" },
                { label: "任务", w: "w-28" },
                { label: "摘要", w: "w-56" },
                ...table.questionColumns.map((c) => ({ label: c, w: "w-48" })),
              ].map((col, i) => (
                <th
                  key={i}
                  className={`${col.w} px-2.5 py-2 text-left font-ui text-caption font-semibold uppercase tracking-wide text-ink-400`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row) => {
              const isSelected = selected.has(row.sessionId);
              return (
                <tr
                  key={row.sessionId}
                  className={`border-b border-ink-100 align-top ${
                    isSelected ? "bg-mauve-50" : "hover:bg-mauve-50/60"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(row.sessionId)}
                      aria-label={`选择 ${row.date}`}
                      className="accent-ink-900"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5 text-ink-600">{row.date}</td>
                  <td className="px-2.5 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={row.status} />
                      <Link
                        href={`/studies/${studyId}/results/${row.sessionId}`}
                        className="font-ui text-body-sm font-medium text-ink-900 transition-colors hover:text-ink-600"
                      >
                        查看转录
                      </Link>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 text-ink-600">{row.task}</td>
                  <td className="px-2.5 py-2.5 leading-6 text-ink-600">{row.summary}</td>
                  {row.answers.map((a, i) => (
                    <td key={i} className="px-2.5 py-2.5 leading-6 text-ink-600">
                      {a}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 底部:分页 + 导出 */}
      <div className="flex shrink-0 items-center justify-between border-t border-ink-200 bg-ink-0 px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="上一页"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="grid size-7 place-items-center rounded border border-ink-200 text-ink-600 transition-colors hover:bg-mauve-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} />
          </button>
          <span className="font-ui text-caption font-medium text-ink-900">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="下一页"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="grid size-7 place-items-center rounded border border-ink-200 text-ink-600 transition-colors hover:bg-mauve-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </button>
        </div>

        <span className="font-ui text-caption text-ink-400">
          已选 {selected.size} / {table.totalCount}
        </span>

        <div className="flex items-center gap-2">
          {singleSelectedId && canDownloadRecording ? (
            <RecordingDownloadButton
              sessionId={singleSelectedId}
              label="下载录像"
              className="inline-flex items-center gap-1.5 rounded border border-ink-200 px-2.5 py-1.5 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-50"
            />
          ) : (
            <button
              type="button"
              disabled
              aria-disabled
              title={recordingDisabledReason ?? undefined}
              className="inline-flex items-center gap-1.5 rounded border border-ink-200 px-2.5 py-1.5 font-ui text-caption text-ink-400"
            >
              <Download className="size-3.5" strokeWidth={2} />
              下载录像
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={selected.size === 0}
            aria-disabled={selected.size === 0}
            className="rounded border border-ink-200 px-2.5 py-1.5 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            导出 CSV
          </button>
        </div>
      </div>
    </div>
  );
}
