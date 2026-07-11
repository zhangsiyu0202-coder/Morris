"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, LayoutGrid } from "lucide-react";
import type { Notebook } from "@merism/contracts";
import { markdownToProseMirror } from "@/lib/notebooks/markdown-to-prose";
import type { ProseMirrorDoc } from "@/lib/notebooks/types";
import { CardViewOrFallback } from "./card-view";
import { DocumentView } from "./document-view";

/**
 * Notebook 总入口 (Wave F T48 cleanup).
 *
 * 渲染路径:
 * 1. 解析 ProseMirror content (Wave D 起 Morris createNotebook + 旧 server
 *    action 都写入此字段); 优先尝试卡片视图 (extractCardSections); 模板
 *    未命中 → 提示切到文档视图。
 * 2. content="" 的极端情况 (旧 Wave A/B fallback) → 空状态提示;
 *    Wave F (T48) 已删除 record.report 字段, 不再渲染 fixed-shape report。
 *
 * D10: 两种视图都只读, 无编辑按钮 / slash command / drag handle / Cmd+S 等.
 */

type ViewMode = "card" | "document";

export function NotebookViewer({ notebook }: { notebook: Notebook }) {
  const [view, setView] = useState<ViewMode>("card");

  const proseMirror = parseProseMirrorContent(notebook.content);
  const hasContent = proseMirror !== null && proseMirror.content.length > 0;

  if (hasContent) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex items-center gap-3">
          <Link
            href="/notebooks"
            className="inline-flex items-center gap-1.5 font-ui text-body-sm text-ink-500 transition-colors hover:text-ink-900"
          >
            <ArrowLeft size={14} /> 全部 Notebook
          </Link>
          <span className="ml-auto inline-flex rounded border border-mauve-200 p-0.5">
            <ViewModeButton
              active={view === "card"}
              onClick={() => setView("card")}
              icon={LayoutGrid}
              label="卡片视图"
            />
            <ViewModeButton
              active={view === "document"}
              onClick={() => setView("document")}
              icon={FileText}
              label="文档视图"
            />
          </span>
        </header>
        <div className="mt-6">
          {view === "card" ? (
            <CardViewOrFallback
              doc={proseMirror!}
              onSwitchToDocument={() => setView("document")}
            />
          ) : (
            <DocumentView doc={proseMirror!} />
          )}
        </div>
      </div>
    );
  }

  // Empty notebook (rare — content="" without a populated ProseMirror)
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-display text-h3 text-ink-900">{notebook.headline}</p>
      <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
        该 Notebook 还没有内容。
      </p>
      <Link
        href="/notebooks"
        className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-mauve-200 px-4 py-2 font-ui text-body-sm font-medium text-ink-900 transition-opacity hover:bg-mauve-100"
      >
        <ArrowLeft size={14} /> 返回列表
      </Link>
    </div>
  );
}

function ViewModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-ui text-caption ${
        active ? "bg-mauve-200 text-ink-900" : "text-ink-500 hover:text-ink-900"
      }`}
      aria-pressed={active}
    >
      <Icon size={13} aria-hidden /> {label}
    </button>
  );
}

/**
 * Parse `Notebook.content` as a ProseMirror JSON doc. Storage convention
 * (Wave B+): `content` is JSON.stringify(ProseMirrorDoc). Returns null if
 * the field is empty / non-JSON / not a doc. Falls back to Markdown parsing
 * defensively (server-side saver should always have converted).
 */
function parseProseMirrorContent(raw: string): ProseMirrorDoc | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as ProseMirrorDoc;
      if (parsed && parsed.type === "doc" && Array.isArray(parsed.content)) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  return markdownToProseMirror(trimmed);
}
