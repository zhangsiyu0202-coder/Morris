"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export function WidgetCard({
  title,
  eyebrow,
  description,
  children,
  onEdit,
  onDelete,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  children: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <section className="group flex min-h-0 flex-col rounded border border-ink-100 bg-ink-0 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
      <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div className="min-w-0">
          <p className="font-ui text-caption font-medium text-ink-400">{eyebrow}</p>
          <h3 className="mt-0.5 truncate font-ui text-body-sm font-semibold text-ink-900">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 line-clamp-1 font-ui text-caption text-ink-400">{description}</p>
          ) : null}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onEdit ? (
              <button
                type="button"
                aria-label="编辑组件"
                onClick={onEdit}
                className="flex size-8 items-center justify-center rounded text-ink-500 hover:bg-mauve-100 hover:text-ink-900"
              >
                <Pencil className="size-4" strokeWidth={2} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                aria-label="删除组件"
                onClick={onDelete}
                className="flex size-8 items-center justify-center rounded text-ink-500 hover:bg-mauve-100 hover:text-ink-900"
              >
                <Trash2 className="size-4" strokeWidth={2} />
              </button>
            ) : (
              <MoreHorizontal className="size-4 text-ink-300" />
            )}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 px-4 py-4">{children}</div>
    </section>
  );
}
