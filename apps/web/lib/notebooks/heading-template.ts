/**
 * Heading-template parser for the Notebook card view.
 *
 * 设计 (D3 决策, design §7.4):
 * Morris 写新 Notebook 时遵循固定 5-段 heading 模板:
 *
 *   # {Question}
 *
 *   {直接回答 paragraph(s)}      ← intro
 *
 *   ## 核心结论
 *   {paragraphs / merism-* nodes}
 *
 *   ## 主题分析
 *   {paragraphs / merism-theme / merism-quote / merism-video-clip}
 *
 *   ## 立场分歧
 *   {paragraphs}
 *
 *   ## 行动建议
 *   {paragraphs / list-like prose}
 *
 * 卡片视图按这 5 段抽出渲染 (复用现有 Insight 卡片 UX). 文档视图渲染完整
 * ProseMirror 树。
 *
 * P-NB-02 (Wave F PBT) 锁定: 给定符合模板的 PM doc, extractCardSections 一定
 * 返回非空 CardSections; 给定模板被破坏 (缺段 / 顺序乱 / heading level 混乱)
 * 的 PM doc, 一定返回 null (前端退化为"切到文档视图查看"提示)。
 */

import type { BlockNode, HeadingNode, ProseMirrorDoc } from "./types";

/** Required H2 section labels in order. */
export const REQUIRED_H2_SECTIONS = [
  "核心结论",
  "主题分析",
  "立场分歧",
  "行动建议",
] as const;

export type RequiredSectionLabel = (typeof REQUIRED_H2_SECTIONS)[number];

export interface CardSections {
  /** H1 question (the original prompt). */
  question: string;
  /** Pre-H2 introductory blocks (the "直接回答" body). */
  intro: BlockNode[];
  /** Each required H2 section, mapped from label → its block content. */
  sections: Record<RequiredSectionLabel, BlockNode[]>;
}

function inlineToText(b: BlockNode): string {
  if (b.type !== "heading" && b.type !== "paragraph") return "";
  return b.content
    .filter((n): n is { type: "text"; text: string } => n.type === "text")
    .map((n) => n.text)
    .join("")
    .trim();
}

/**
 * Try to extract the 5-section card view from a ProseMirror doc.
 * Returns null if the heading template is not strictly satisfied:
 * - exactly one H1 first
 * - the four required H2 labels appear in order, each at most once
 * - no other H1s anywhere
 */
export function extractCardSections(doc: ProseMirrorDoc): CardSections | null {
  if (!doc?.content || doc.content.length === 0) return null;

  // 1. First block must be H1 with non-empty text.
  const first = doc.content[0];
  if (!first || first.type !== "heading" || first.attrs.level !== 1) return null;
  const question = inlineToText(first);
  if (!question) return null;

  // 2. Walk remaining blocks. Collect intro until first H2; then partition by
  //    H2 headings whose text matches a required label in expected order.
  const intro: BlockNode[] = [];
  const sections: Partial<Record<RequiredSectionLabel, BlockNode[]>> = {};
  let currentLabelIdx = -1; // -1 = pre-H2 (intro phase)
  let currentLabel: RequiredSectionLabel | null = null;
  let buffer: BlockNode[] = intro;

  for (let i = 1; i < doc.content.length; i++) {
    const b = doc.content[i]!;
    // Disallow extra H1s anywhere after the first block.
    if (b.type === "heading" && b.attrs.level === 1) return null;
    if (b.type === "heading" && b.attrs.level === 2) {
      const text = inlineToText(b);
      const expectedNextIdx = currentLabelIdx + 1;
      const expectedLabel = REQUIRED_H2_SECTIONS[expectedNextIdx];
      if (!expectedLabel || text !== expectedLabel) {
        // Either out-of-order or unknown H2 — template broken.
        return null;
      }
      // Open new section bucket.
      currentLabelIdx = expectedNextIdx;
      currentLabel = expectedLabel;
      buffer = [];
      sections[expectedLabel] = buffer;
      continue;
    }
    // Append block to current bucket (intro or current section).
    buffer.push(b);
    void currentLabel; // unused but kept for trace clarity
  }

  // 3. All required H2 labels must have appeared.
  for (const label of REQUIRED_H2_SECTIONS) {
    if (!sections[label]) return null;
  }

  return {
    question,
    intro,
    sections: sections as Record<RequiredSectionLabel, BlockNode[]>,
  };
}
