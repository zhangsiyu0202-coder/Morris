"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Sparkles, X, Maximize2 } from "lucide-react";
import { Conversation } from "./conversation";

const SUGGESTIONS = ["分析当前调研结果", "受访者最常抱怨什么?", "帮我起草一份新调研"];

export function AssistantDock() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Hide the floating dock on the standalone assistant page to avoid duplication.
  const hidden = pathname?.startsWith("/assistant");

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-ink-800 px-4 py-3 font-ui text-body-sm font-medium text-ink-0 shadow-lg transition-colors hover:bg-ink-900"
          aria-label="打开研究助手"
        >
          <Sparkles size={18} />
          <span className="hidden sm:inline">研究助手</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink-900/20 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-label="研究助手"
            className="absolute right-0 top-0 flex h-full w-full flex-col bg-mauve-50 shadow-popover sm:w-[440px]"
          >
            <header className="flex items-center justify-between border-b border-mauve-200 bg-ink-0 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-mauve-100 text-ink-600">
                  <Sparkles size={15} />
                </span>
                <span className="font-display text-body-lg text-ink-900">研究助手</span>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/assistant"
                  className="flex size-8 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-mauve-100 hover:text-ink-800"
                  aria-label="在独立页面打开"
                >
                  <Maximize2 size={16} />
                </Link>
                <button
                  onClick={() => setOpen(false)}
                  className="flex size-8 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-mauve-100 hover:text-ink-800"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1">
              <Conversation suggestions={SUGGESTIONS} compact />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
