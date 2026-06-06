"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  ChevronRight,
  Bookmark,
  FileBarChart,
} from "lucide-react";
import { STATUS_LABELS, type StudyStatus } from "@/lib/guide";
import { createSurvey, deleteSurvey } from "@/lib/actions/survey";
import type { SurveyListItem } from "@/lib/survey-read";
import {
  getMockBookmarks,
  getMockHomeReports,
} from "@/lib/mock/workspace";

const STATUS_PILL: Record<StudyStatus, string> = {
  live: "bg-mauve-50 text-ink-900",
  draft: "bg-mauve-50 text-ink-900",
  closed: "bg-mauve-100 text-ink-900",
};

const STATUS_DOT: Record<StudyStatus, string> = {
  live: "bg-positive",
  draft: "bg-mauve-400",
  closed: "bg-ink-200",
};

/**
 * 首页仪表盘(参考 Make 结构,重绘为 Mauve Quiet):
 * 顶部调研横向卡片(真实数据)+ 下方书签墙(mock)与报告预览(mock)。
 */
export function StudiesHome({ studies }: { studies: SurveyListItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const bookmarks = getMockBookmarks();
  const reports = getMockHomeReports();

  return (
    <main className="min-h-full bg-mauve-50 px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-display-lg text-ink-900">首页</h1>

        {/* 调研 */}
        <section className="mt-6">
          <SectionHeader title="调研" actionLabel="新建调研" onAction={() => setCreating(true)} />
          {studies.length === 0 ? (
            <EmptyStudies onCreate={() => setCreating(true)} />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {studies.map((s) => (
                <StudyMiniCard key={s.id} study={s} onDeleted={() => router.refresh()} />
              ))}
            </div>
          )}
        </section>

        <div className="my-7 h-px bg-ink-100" />

        {/* 书签 + 报告 */}
        <div className="flex flex-col gap-7 lg:flex-row">
          <section className="min-w-0 flex-1">
            <SectionHeader title="书签" />
            <div className="flex flex-col gap-3">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="flex gap-3 rounded-md p-2 transition-colors hover:bg-ink-100"
                >
                  <span
                    className="grid shrink-0 place-items-center rounded bg-mauve-100"
                    style={{ width: 56, height: 46 }}
                    aria-hidden
                  >
                    <Bookmark className="size-4 text-ink-900" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-ui text-caption font-semibold text-ink-600">
                        {bm.respondent}
                      </span>
                      <span className="shrink-0 font-data text-caption text-ink-400">{bm.date}</span>
                    </div>
                    <p className="line-clamp-2 font-reading text-caption leading-5 text-ink-600">
                      {bm.quote}
                    </p>
                    <p className="mt-0.5 font-ui text-caption text-ink-400">{bm.source}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="hidden w-px bg-ink-100 lg:block" />

          <section className="w-full shrink-0 lg:w-60">
            <SectionHeader title="报告" actionLabel="查看全部" href="/reports" />
            <div className="flex flex-col gap-3">
              {reports.map((rp) => (
                <Link
                  key={rp.id}
                  href="/reports"
                  className="flex gap-3 rounded-md p-2 transition-colors hover:bg-ink-100"
                >
                  <span
                    className="grid shrink-0 place-items-center rounded bg-mauve-100"
                    style={{ width: 44, height: 36 }}
                    aria-hidden
                  >
                    <FileBarChart className="size-4 text-ink-900" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-ui text-body-sm font-semibold text-ink-900">
                      {rp.title}
                    </p>
                    <p className="font-ui text-caption text-ink-400">{rp.subtitle}</p>
                    <p className="mt-0.5 font-ui text-caption text-ink-400">最后运行:{rp.lastRun}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/studies/${id}/guide`)}
        />
      )}
    </main>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  const action = actionLabel ? (
    href ? (
      <Link
        href={href}
        className="inline-flex items-center gap-0.5 font-ui text-caption text-ink-400 transition-colors hover:text-ink-900"
      >
        {actionLabel}
        <ChevronRight className="size-3.5" strokeWidth={2} />
      </Link>
    ) : (
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-1 font-ui text-caption text-ink-400 transition-colors hover:text-ink-900"
      >
        <Plus className="size-3.5" strokeWidth={2} />
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="font-ui text-body-sm font-semibold text-ink-900">{title}</span>
      {action}
    </div>
  );
}

function StudyMiniCard({
  study,
  onDeleted,
}: {
  study: SurveyListItem;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定删除「${study.title}」?此操作不可撤销。`)) return;
    startTransition(async () => {
      await deleteSurvey(study.id);
      onDeleted();
    });
  };

  return (
    <Link
      href={`/studies/${study.id}`}
      className="group relative flex w-40 shrink-0 flex-col rounded-lg border border-ink-200 bg-ink-0 p-3.5 shadow-sm transition-shadow hover:shadow"
    >
      <p className="line-clamp-2 min-h-9 font-ui text-body-sm font-semibold leading-5 text-ink-900">
        {study.title}
      </p>
      <span
        className={`mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 font-decor text-caption ${STATUS_PILL[study.status]}`}
      >
        <span className={`size-1.5 rounded-full ${STATUS_DOT[study.status]}`} aria-hidden />
        {STATUS_LABELS[study.status]}
      </span>
      <p className="mt-2 font-ui text-caption text-ink-400">{study.responses} 份完成回收</p>

      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label="删除调研"
        className="absolute right-2 top-2 grid size-6 place-items-center rounded text-ink-400 opacity-0 transition-all hover:bg-ink-100 hover:text-ink-900 focus:opacity-100 group-hover:opacity-100"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" strokeWidth={2} />
        )}
      </button>
    </Link>
  );
}

function EmptyStudies({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-200 bg-ink-0 py-10 font-ui text-body-sm font-medium text-ink-400 transition-colors hover:border-ink-400 hover:text-ink-900"
    >
      <Plus className="size-4" strokeWidth={2} />
      新建第一个调研
    </button>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const id = await createSurvey(title);
      onCreated(id);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md bg-ink-0 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-display-md text-ink-900">新建调研</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid size-8 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
        <label className="mt-5 block font-ui text-body-sm font-medium text-ink-800">
          调研名称
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="例如:差旅住宿预订习惯调研"
          className="mt-2 w-full rounded border border-ink-200 bg-ink-0 px-3 py-2.5 font-ui text-body-sm text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            创建并编辑提纲
          </button>
        </div>
      </div>
    </div>
  );
}
