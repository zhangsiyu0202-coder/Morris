"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, FileText, Users, Layers, Trash2, X, Loader2 } from "lucide-react";
import { STATUS_LABELS, type StudyStatus } from "@/lib/guide";
import { createStudy, deleteStudy, type StudyCard } from "@/lib/actions/studies";

const STATUS_STYLES: Record<StudyStatus, string> = {
  live: "bg-mauve-50 text-ink-900",
  draft: "bg-mauve-50 text-ink-900",
  closed: "bg-mauve-100 text-ink-900",
};

const STATUS_DOT: Record<StudyStatus, string> = {
  live: "bg-positive",
  draft: "bg-mauve-400",
  closed: "bg-ink-200",
};

export function StudiesHome({ studies }: { studies: StudyCard[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <main className="min-h-full bg-mauve-50 px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-ui text-caption font-medium uppercase tracking-wider text-ink-400">
              Studies
            </p>
            <h1 className="mt-2 text-pretty font-display text-display-lg text-ink-900">
              我的调研
            </h1>
            <p className="mt-2 max-w-xl font-ui text-body-sm leading-6 text-ink-600">
              每个调研都有一份访谈提纲。点击卡片进入编辑提纲,或新建一个调研。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
          >
            <Plus className="size-4" strokeWidth={2.5} />
            新建调研
          </button>
        </header>

        {studies.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {studies.map((s) => (
              <StudyCardItem key={s.id} study={s} onDeleted={() => router.refresh()} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/studies/${id}`)}
        />
      )}
    </main>
  );
}

function StudyCardItem({
  study,
  onDeleted,
}: {
  study: StudyCard;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定删除「${study.title}」?此操作不可撤销。`)) return;
    startTransition(async () => {
      await deleteStudy(study.id);
      onDeleted();
    });
  };

  return (
    <Link
      href={`/studies/${study.id}`}
      className="group relative flex flex-col rounded border border-ink-100 bg-ink-0 p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-ui text-caption font-medium ${STATUS_STYLES[study.status]}`}
        >
          <span className={`size-1.5 rounded-full ${STATUS_DOT[study.status]}`} aria-hidden />
          {STATUS_LABELS[study.status]}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label="删除调研"
          className="grid size-7 place-items-center rounded text-ink-400 opacity-0 transition-all hover:bg-ink-100 hover:text-ink-600 focus:opacity-100 group-hover:opacity-100"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" strokeWidth={2} />
          )}
        </button>
      </div>

      <h2 className="mt-3 text-pretty font-ui text-body font-semibold leading-6 text-ink-900">
        {study.title}
      </h2>
      {study.researchGoal && (
        <p className="mt-1.5 line-clamp-2 font-ui text-body-sm leading-6 text-ink-400">
          {study.researchGoal}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-4 font-ui text-caption text-ink-400">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="size-3.5" strokeWidth={2} />
          {study.sectionCount} 节
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" strokeWidth={2} />
          {study.questionCount} 题
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" strokeWidth={2} />
          {study.responses} 份回收
        </span>
      </div>
    </Link>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-8 flex flex-col items-center justify-center rounded border border-dashed border-ink-200 bg-ink-0 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-mauve-100">
        <FileText className="size-6 text-ink-900" strokeWidth={2} />
      </div>
      <h2 className="mt-4 font-ui text-body font-semibold text-ink-900">还没有调研</h2>
      <p className="mt-1.5 max-w-sm font-ui text-body-sm leading-6 text-ink-400">
        新建一个调研,编辑它的访谈提纲,就能开始收集访谈了。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        新建调研
      </button>
    </div>
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
      const id = await createStudy(title);
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
        className="w-full max-w-md rounded bg-ink-0 p-6 shadow-lg"
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
            className="h-10 rounded px-4 font-ui text-body-sm font-medium text-ink-600 transition-colors hover:bg-ink-100"
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
