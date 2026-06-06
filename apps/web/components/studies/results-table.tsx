"use client";

import { useState } from "react";
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
import {
  SESSION_STATUS_LABELS,
  type ResultsTable,
  type SessionDisplayStatus,
} from "@/lib/mock/workspace";

/**
 * 结果大表:筛选 chip + 数据表 + 分页 + 导出(mock)。
 * 状态单色(图标 + 文案);表格正文用 font-data。
 */

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

export function ResultsTableView({
  studyId,
  table,
}: {
  studyId: string;
  table: ResultsTable;
}) {
  const [activeFilter, setActiveFilter] = useState<"all" | SessionDisplayStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows =
    activeFilter === "all"
      ? table.rows
      : table.rows.filter((r) => r.status === activeFilter);

  const allChecked = selected.size === rows.length && rows.length > 0;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.sessionId)));
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
                  aria-label="全选"
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
            {rows.map((row) => {
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
                        className="font-ui text-caption font-medium text-ink-900 transition-colors hover:text-ink-600"
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

      {/* 底部:分页 + 导出(mock) */}
      <div className="flex shrink-0 items-center justify-between border-t border-ink-200 bg-ink-0 px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="上一页"
            className="grid size-7 place-items-center rounded border border-ink-200 text-ink-600 transition-colors hover:bg-mauve-50"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} />
          </button>
          <span className="font-ui text-caption font-medium text-ink-900">1</span>
          <button
            type="button"
            aria-label="下一页"
            className="grid size-7 place-items-center rounded border border-ink-200 text-ink-600 transition-colors hover:bg-mauve-50"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </button>
        </div>

        <span className="font-ui text-caption text-ink-400">
          已选 {selected.size} / {table.totalCount}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-ink-200 px-2.5 py-1.5 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-50"
          >
            <Download className="size-3.5" strokeWidth={2} />
            下载录音
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2.5 py-1.5 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-50"
          >
            导出 CSV
          </button>
        </div>
      </div>
    </div>
  );
}
