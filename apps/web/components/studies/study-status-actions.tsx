"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { updateSurveyStatus } from "@/lib/actions/survey";
import type { StudyStatus } from "@/lib/guide";

/**
 * Status-aware action controls rendered in the workspace header.
 *
 * draft  → "发布" (primary)
 * live   → "暂停" (primary) + overflow "结束"
 * paused → "恢复" (primary) + overflow "结束"
 * closed → overflow "归档"
 * archived → no actions
 *
 * "结束" requires a Dialog confirmation step (Mauve Quiet destructive pattern:
 * monochrome, copy-driven, no red).
 */

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

function ConfirmDialog({ open, onClose, onConfirm, pending }: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-ink-0 p-6 shadow-lg">
        <h2
          id="end-dialog-title"
          className="mb-2 font-ui text-display-md font-semibold text-ink-900"
        >
          确认结束调研？
        </h2>
        <p className="mb-1 font-ui text-body-sm text-ink-600">
          结束后将停止新的访谈 session 开始；进行中的访谈不受影响，受访者可完成当前会话。
        </p>
        <p className="mb-6 font-ui text-body-sm font-semibold text-ink-900">
          此操作不可撤销。
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-10 items-center rounded border border-ink-900 bg-ink-0 px-4 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-10 items-center rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
          >
            {pending ? "处理中…" : "确认结束"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OverflowMenuProps {
  onEnd: () => void;
}

function OverflowMenu({ onEnd }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <MoreHorizontal className="size-5" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 min-w-[120px] rounded border border-ink-200 bg-ink-0 py-1 shadow-popover">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEnd();
            }}
            className="w-full px-4 py-2 text-left font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50"
          >
            结束
          </button>
        </div>
      )}
    </div>
  );
}

export function StudyStatusActions({
  surveyId,
  status,
}: {
  surveyId: string;
  status: StudyStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  function transition(target: "live" | "paused" | "closed" | "archived") {
    startTransition(async () => {
      await updateSurveyStatus(surveyId, target);
      router.refresh();
    });
  }

  if (status === "draft") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => transition("live")}
        className="inline-flex h-8 items-center rounded border border-ink-900 bg-ink-0 px-3 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-50"
      >
        发布
      </button>
    );
  }

  if (status === "live") {
    return (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => transition("paused")}
          className="inline-flex h-8 items-center rounded bg-mauve-200 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
        >
          暂停
        </button>
        <OverflowMenu onEnd={() => setShowEndConfirm(true)} />
        <ConfirmDialog
          open={showEndConfirm}
          onClose={() => setShowEndConfirm(false)}
          onConfirm={() => {
            setShowEndConfirm(false);
            transition("closed");
          }}
          pending={pending}
        />
      </>
    );
  }

  if (status === "paused") {
    return (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => transition("live")}
          className="inline-flex h-8 items-center rounded bg-mauve-200 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-50"
        >
          恢复
        </button>
        <OverflowMenu onEnd={() => setShowEndConfirm(true)} />
        <ConfirmDialog
          open={showEndConfirm}
          onClose={() => setShowEndConfirm(false)}
          onConfirm={() => {
            setShowEndConfirm(false);
            transition("closed");
          }}
          pending={pending}
        />
      </>
    );
  }

  if (status === "closed") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => transition("archived")}
        className="inline-flex h-8 items-center rounded border border-ink-900 bg-ink-0 px-3 font-ui text-body-sm text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-50"
      >
        归档
      </button>
    );
  }

  // archived — no actions
  return null;
}
