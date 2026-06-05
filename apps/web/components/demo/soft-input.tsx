"use client";

import { useState } from "react";
import { Search, ArrowUp } from "lucide-react";

/**
 * 示例输入框 —— 复刻 Accordion 卡片的视觉格式:
 * - 大圆角 radius-xl (20px)
 * - 柔和莫兰迪阴影 0 2px 4px rgba(167,133,133,0.08)（= mauve-400 @ 8%）
 * - 白底、极简、无硬边框（聚焦时阴影微微加深 + 一圈极淡内描边)
 */
export function SoftInput() {
  const [value, setValue] = useState("");

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      {/* 单行输入框 */}
      <div>
        <label className="mb-2 block font-ui text-sm text-ink-600">单行输入框</label>
        <div className="group flex items-center gap-3 rounded-[20px] bg-ink-0 px-5 py-4 shadow-[0px_2px_4px_rgba(167,133,133,0.08)] transition-shadow duration-200 focus-within:shadow-[0px_4px_12px_rgba(167,133,133,0.16)]">
          <Search className="size-5 shrink-0 text-ink-400" aria-hidden />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="搜索调研、洞察或受访者…"
            className="min-w-0 flex-1 bg-transparent font-ui text-body text-ink-800 placeholder:text-ink-400 focus:outline-none"
          />
        </div>
      </div>

      {/* 多行文本框 */}
      <div>
        <label className="mb-2 block font-ui text-sm text-ink-600">多行文本框</label>
        <div className="group rounded-[20px] bg-ink-0 p-5 shadow-[0px_2px_4px_rgba(167,133,133,0.08)] transition-shadow duration-200 focus-within:shadow-[0px_4px_12px_rgba(167,133,133,0.16)]">
          <textarea
            rows={4}
            placeholder="写下你的问题或备注…"
            className="w-full resize-none bg-transparent font-reading text-body leading-7 text-ink-800 placeholder:text-ink-400 focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="font-ui text-xs text-ink-400">支持 Markdown</span>
            <button
              type="button"
              aria-label="发送"
              className="grid size-9 place-items-center rounded-xl bg-mauve-200 text-ink-900 shadow-[0px_2px_4px_rgba(167,133,133,0.16)] transition-colors hover:bg-mauve-400 hover:text-ink-0"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
