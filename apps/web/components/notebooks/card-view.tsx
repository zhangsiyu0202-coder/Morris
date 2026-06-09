"use client";

import { GitCompareArrows, ListChecks, Sparkles, Layers } from "lucide-react";
import type { BlockNode, ProseMirrorDoc } from "@/lib/notebooks/types";
import { extractCardSections, REQUIRED_H2_SECTIONS } from "@/lib/notebooks/heading-template";
import type { CardSections } from "@/lib/notebooks/heading-template";
import { DocumentView } from "./document-view";

/**
 * Card view: 按 HeadingTemplate (5 段 H1+4×H2) 抽段渲染卡片版。
 *
 * 设计 (D3 决策, design §7.4): 复用现有 Insight 卡片 UX 风格 (mauve 卡片 +
 * 左侧 lucide icon + 标题 + 内容). 模板未命中时降级 → 提示"切到文档视图查看"。
 *
 * 卡片视图与文档视图都只读 (D10)。
 */

const SECTION_ICONS = {
  核心结论: Sparkles,
  主题分析: Layers,
  立场分歧: GitCompareArrows,
  行动建议: ListChecks,
} as const;

function SectionCard({
  label,
  icon: Icon,
  blocks,
}: {
  label: string;
  icon: typeof Sparkles;
  blocks: BlockNode[];
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-mauve-50 px-5 py-5 shadow-sm">
      <header className="flex items-center gap-2">
        <Icon size={16} className="text-ink-700" aria-hidden />
        <h2 className="font-display text-display-md text-ink-900">{label}</h2>
      </header>
      <div className="-mt-2">
        <DocumentView doc={{ type: "doc", content: blocks }} />
      </div>
    </section>
  );
}

export function CardView({ sections }: { sections: CardSections }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-xl bg-mauve-200 px-8 pt-10 pb-12 shadow-sm">
        <p className="font-ui text-caption uppercase tracking-wide text-ink-700">
          研究问题
        </p>
        <h1 className="mt-2 font-display text-display-xl text-ink-900">
          {sections.question}
        </h1>
        {sections.intro.length > 0 ? (
          <div className="mt-4 -ml-1 max-w-prose">
            <DocumentView doc={{ type: "doc", content: sections.intro }} />
          </div>
        ) : null}
      </header>
      {REQUIRED_H2_SECTIONS.map((label) => {
        const Icon = SECTION_ICONS[label];
        return (
          <SectionCard
            key={label}
            label={label}
            icon={Icon}
            blocks={sections.sections[label]}
          />
        );
      })}
    </div>
  );
}

/**
 * Wrapper: tries CardView, falls back to a "modeling not matched" hint with
 * a button to switch to document view (parent owns the view-mode state).
 */
export function CardViewOrFallback({
  doc,
  onSwitchToDocument,
}: {
  doc: ProseMirrorDoc;
  onSwitchToDocument: () => void;
}) {
  const sections = extractCardSections(doc);
  if (sections) return <CardView sections={sections} />;
  return (
    <div className="rounded-lg border border-mauve-200 bg-mauve-50 px-6 py-10 text-center">
      <p className="font-display text-display-md text-ink-900">
        卡片视图无法解析此 Notebook
      </p>
      <p className="mt-2 font-ui text-body-sm text-ink-600">
        Notebook 的标题结构不符合 5 段模板, 请切换到文档视图查看完整内容。
      </p>
      <button
        type="button"
        onClick={onSwitchToDocument}
        className="mt-4 inline-flex items-center gap-1.5 rounded bg-mauve-200 px-4 py-2 font-ui text-body-sm font-medium text-ink-900 hover:bg-mauve-100"
      >
        切换到文档视图
      </button>
    </div>
  );
}
