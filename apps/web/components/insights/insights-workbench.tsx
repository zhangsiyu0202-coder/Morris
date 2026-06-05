"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Lightbulb,
  Sparkles,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { createInsight, deleteInsight, type InsightListItem } from "@/lib/actions/insights";

type StudyOption = {
  id: string;
  title: string;
  status: "draft" | "live" | "closed";
  responses: number;
};

const SUGGESTED_QUESTIONS = [
  "受访者最主要的痛点是什么?",
  "哪些因素最影响用户的满意度?",
  "不同受访者的观点有哪些明显分歧?",
  "我们下一步应该优先改进什么?",
];

const STATUS_LABEL: Record<StudyOption["status"], string> = {
  live: "进行中",
  draft: "草稿",
  closed: "已结束",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "高置信度",
  medium: "中等置信度",
  low: "低置信度",
};

export function InsightsWorkbench({
  studies,
  cards,
}: {
  studies: StudyOption[];
  cards: InsightListItem[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      await deleteInsight(id);
      router.refresh();
      setDeletingId(null);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      {/* 标题区 + 新建按钮 */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded bg-mauve-100 px-2.5 py-1 font-ui text-caption font-medium uppercase tracking-wide text-ink-600">
            <Lightbulb size={13} /> Insights
          </span>
          <h1 className="font-display text-display-lg text-ink-900 text-balance">研究洞察</h1>
          <p className="font-ui text-body-sm leading-6 text-ink-400">
            每一张卡片对应一个聚焦问题,点击进入可查看结合会话内容的深度分析报告。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded bg-ink-900 px-4 font-ui text-body-sm font-medium text-ink-0 transition-opacity hover:opacity-90"
        >
          <Plus size={15} /> New insight
        </button>
      </header>

      {/* 卡片网格 / 空状态 */}
      {cards.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-mauve-200 bg-mauve-50 px-6 py-16 text-center transition-colors hover:bg-mauve-100"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-mauve-100 text-ink-600">
            <Sparkles size={20} />
          </span>
          <p className="font-ui text-body-sm font-medium text-ink-800">还没有洞察</p>
          <p className="max-w-xs font-ui text-caption leading-5 text-ink-400">
            点击「New insight」,选择一项调研并提出问题,一键生成深度分析。
          </p>
        </button>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="group relative flex flex-col rounded bg-mauve-50 shadow-[0_2px_4px_rgba(167,133,133,0.08)] transition-transform hover:-translate-y-0.5"
            >
              <button
                type="button"
                aria-label="删除洞察"
                onClick={() => handleDelete(card.id)}
                disabled={deletingId === card.id}
                className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded text-ink-300 opacity-0 transition-all hover:bg-mauve-200 hover:text-ink-700 group-hover:opacity-100 disabled:opacity-100"
              >
                {deletingId === card.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
              <Link href={`/insights/${card.id}`} className="flex flex-1 flex-col gap-3 px-5 py-5">
                <div className="flex items-center gap-2 pr-7">
                  <p className="line-clamp-1 font-ui text-caption uppercase tracking-wide text-ink-400">
                    {card.studyTitle}
                  </p>
                  <span className="ml-auto shrink-0 rounded-full bg-mauve-200 px-2 py-0.5 font-ui text-caption font-medium text-ink-700">
                    {CONFIDENCE_LABEL[card.confidence] ?? card.confidence}
                  </span>
                </div>
                <p className="line-clamp-2 font-ui text-body-sm font-medium leading-6 text-ink-500">
                  {card.question}
                </p>
                <h2 className="line-clamp-2 font-display text-display-sm leading-tight text-ink-900 text-pretty">
                  {card.headline}
                </h2>
                <p className="line-clamp-3 font-ui text-body-sm leading-6 text-ink-600">
                  {card.summary}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 font-ui text-caption font-medium text-ink-600">
                  查看深度分析 <ArrowRight size={12} />
                </span>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* 创建 modal */}
      {createOpen && (
        <CreateInsightModal
          studies={studies}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            router.push(`/insights/${id}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------- 创建 modal:含原表单 ---------- */
function CreateInsightModal({
  studies,
  onClose,
  onCreated,
}: {
  studies: StudyOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const canGenerate = studyId && question.trim().length >= 2 && status !== "loading";

  async function generate() {
    if (!canGenerate) return;
    setStatus("loading");
    setErrorMsg("");
    const result = await createInsight({ studyId, question: question.trim() });
    if ("error" in result) {
      setErrorMsg(result.error);
      setStatus("error");
      return;
    }
    onCreated(result.id);
  }

  return (
    <ModalShell title="生成新洞察" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="study" className="font-ui text-body-sm font-medium text-ink-800">
            选择调研
          </label>
          <select
            id="study"
            value={studyId}
            onChange={(e) => setStudyId(e.target.value)}
            className="h-10 w-full rounded border border-mauve-200 bg-ink-0 px-3 font-ui text-body-sm text-ink-900 outline-none transition-colors focus:border-mauve-400"
          >
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {STATUS_LABEL[s.status]}({s.responses} 份)
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="question" className="font-ui text-body-sm font-medium text-ink-800">
            你的问题
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="例如:受访者对搜索筛选体验的主要不满是什么?"
            className="w-full resize-none rounded border border-mauve-200 bg-ink-0 px-3 py-2.5 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-mauve-400"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className="rounded-full bg-mauve-100 px-3 py-1 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-200"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {status === "error" && (
          <div className="flex items-start gap-2 rounded border border-mauve-200 bg-mauve-100 px-4 py-3">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
              <AlertTriangle size={15} />
            </span>
            <p className="flex-1 font-ui text-body-sm leading-6 text-ink-800">{errorMsg}</p>
          </div>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-ink-900 px-4 font-ui text-body-sm font-medium text-ink-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "loading" ? (
            <>
              <Loader2 size={15} className="animate-spin" /> 结合会话深入分析中…
            </>
          ) : (
            <>
              <Sparkles size={15} /> 生成洞察
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------- 通用 modal 外壳 ---------- */
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-8 sm:py-12"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded bg-ink-0 shadow-[0_8px_32px_rgba(60,40,50,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-mauve-200 px-5 py-4">
          <h2 className="font-ui text-body font-semibold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded text-ink-400 transition-colors hover:bg-mauve-100 hover:text-ink-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
