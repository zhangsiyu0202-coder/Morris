"use client";

/**
 * Morris assistant markdown 渲染。基于 Vercel 官方 streaming markdown 组件
 * `streamdown` (https://streamdown.ai)。
 *
 * 选 streamdown 而不是 react-markdown 的理由 (来自官方 migrate guide
 * https://streamdown.ai/docs/migrate):
 *  - **Unterminated block parsing**: 流式输出半截 markdown 时不会出现 `**bold`
 *    或半个代码块这种丑陋中间态。
 *  - **内置 GFM** (表格 / 任务列表 / 删除线 / 自动链接), 不需要单独装 remark-gfm。
 *  - **@streamdown/cjk** 插件给中文用户拼写友好的标点 + 分词 (我们是中文产品)。
 *  - **@streamdown/code** 内置 Shiki 代码高亮 + copy/download 按钮, 不需要自己
 *    包 react-syntax-highlighter。
 *  - 内部已 memoization, 不需要 MemoizedReactMarkdown 包装。
 *
 * streamdown 与 react-markdown 100% prop 兼容 — 我们的 components map 全部保留,
 * 维持 Mauve Quiet 设计系统的字体角色 (font-display / font-reading / font-ui)
 * 与字号 token (text-display-sm / text-body / text-caption)。
 *
 * Tailwind 4 配置: globals.css 里已加 `@source ".../streamdown/dist/*.js"`,
 * 让 streamdown 内部默认样式的 utility class 也被扫到 (即使我们 components
 * map 覆盖了大部分元素, 内部 default 渲染路径仍走它的 className)。
 */

import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="font-reading text-body leading-7 text-ink-800">
      <Streamdown
        plugins={{ code, cjk }}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 font-display text-display-sm text-ink-900 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 font-display text-body-lg font-semibold text-ink-900 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 font-ui text-body font-semibold text-ink-900 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 ml-1 flex flex-col gap-1.5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 ml-5 flex list-decimal flex-col gap-1.5 last:mb-0">{children}</ol>,
          li: ({ children }) => (
            <li className="flex gap-2 [ol_&]:list-item [ol_&]:pl-1">
              <span className="mt-2.5 size-1 shrink-0 rounded-full bg-ink-300 [ol_&]:hidden" />
              <span className="min-w-0">{children}</span>
            </li>
          ),
          strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} className="text-ink-700 underline decoration-mauve-300 underline-offset-2 hover:text-ink-900">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-mauve-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-800">{children}</code>
          ),
          hr: () => <hr className="my-4 border-mauve-200" />,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-mauve-300 pl-3 text-ink-600">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-mauve-200">
              <table className="w-full border-collapse text-body-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-mauve-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-mauve-200 px-3 py-2 text-left font-ui font-semibold text-ink-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-mauve-100 px-3 py-2 text-ink-700 last:[&]:border-b-0">{children}</td>
          ),
        }}
      >
        {children}
      </Streamdown>
    </div>
  );
}
