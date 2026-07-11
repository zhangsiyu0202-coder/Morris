"use client";

import type {
  BlockNode,
  HeadingNode,
  InlineNode,
  ParagraphNode,
  ProseMirrorDoc,
} from "@/lib/notebooks/types";
import { MerismNodeRenderer } from "./nodes/merism-nodes";

/**
 * Document view: 直接渲染完整 ProseMirror JSON 树。
 *
 * 设计 (D10 决策): **只读** — 不引入 Tiptap 编辑器 / starter-kit / slash
 * command / drag handle / 工具栏。研究员要修改 → 跟 Morris 对话生成新一份。
 *
 * 这个组件同时被:
 * - 内部 detail 页(默认渲染完整 8 类 merism-* node)
 * - publish 页(content 已经被 filter-for-publishing.ts 处理过, 渲染时 stripped node
 *   走 fallback case)
 */

function renderInline(content: InlineNode[]): React.ReactNode[] {
  return content.map((node, i) => {
    if (node.type === "text") {
      return <span key={i}>{node.text}</span>;
    }
    return (
      <span key={i} className="mx-0.5">
        <MerismNodeRenderer node={node} />
      </span>
    );
  });
}

function renderBlock(block: BlockNode, key: number): React.ReactNode {
  if (block.type === "heading") {
    const h = block as HeadingNode;
    const inner = renderInline(h.content);
    if (h.attrs.level === 1) {
      return (
        <h1 key={key} className="font-display text-display-xl text-ink-900 mt-8 mb-4">
          {inner}
        </h1>
      );
    }
    if (h.attrs.level === 2) {
      return (
        <h2 key={key} className="font-display text-display-lg text-ink-900 mt-6 mb-3">
          {inner}
        </h2>
      );
    }
    return (
      <h3 key={key} className="font-display text-display-md text-ink-900 mt-4 mb-2">
        {inner}
      </h3>
    );
  }
  if (block.type === "paragraph") {
    const p = block as ParagraphNode;
    return (
      <p key={key} className="font-reading text-body leading-7 text-ink-800 my-3">
        {renderInline(p.content)}
      </p>
    );
  }
  // Block-level merism atom or stripped placeholder
  return (
    <div key={key} className="my-4">
      <MerismNodeRenderer node={block} />
    </div>
  );
}

export function DocumentView({ doc }: { doc: ProseMirrorDoc }) {
  if (!doc?.content || doc.content.length === 0) {
    return (
      <div className="font-reading text-body-sm text-ink-500 italic">
        (空 Notebook — Morris 还没写入内容)
      </div>
    );
  }
  return (
    <article className="prose-notebook flex flex-col">
      {doc.content.map((b, i) => renderBlock(b, i))}
    </article>
  );
}
